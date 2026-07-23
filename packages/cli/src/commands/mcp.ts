import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Command } from 'commander';
import { z } from 'zod';
import { getEffectiveConfig } from '../services/config.js';
import { readSyncState } from '../services/sync-state.js';

// ---------------------------------------------------------------------------
// Zod schemas for API response validation
// ---------------------------------------------------------------------------

const TrendsSummarySchema = z.object({
  avgCostPerRunCents: z.number().nullable().optional(),
  totalCostCents: z.number(),
  totalRuns: z.number(),
});

const TimeSeriesItemSchema = z.object({
  costCents: z.number(),
  date: z.string(),
  runs: z.number(),
});

const TrendsResponseSchema = z.object({
  summary: TrendsSummarySchema,
  timeSeries: z.array(TimeSeriesItemSchema),
});

const ContributorSchema = z.object({
  connectionStatus: z.string().optional(),
  login: z.string(),
  totalCostCents: z.number(),
  totalRuns: z.number(),
});

const ContributorsResponseSchema = z.array(ContributorSchema);

const RunResponseSchema = z.object({
  costCents: z.number().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  engine: z.string().optional(),
  model: z.string().nullable().optional(),
  sessionId: z.string(),
  status: z.string().optional(),
  title: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialises a value as a plain text MCP tool result
 */
function textResult(value: unknown): { content: [{ text: string; type: 'text' }] } {
  return {
    content: [{ text: JSON.stringify(value, null, 2), type: 'text' as const }],
  };
}

/**
 * Discriminated result from fetchJson — either successful with data or failed with an error message
 */
type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Returns a Bearer-authed fetch result, parsed through the given Zod schema.
 * On any failure returns `{ ok: false, error }` instead of throwing.
 */
async function fetchJson<T>({
  apiKey,
  apiUrl,
  schema,
  path,
}: {
  /** API key for Authorization header */
  apiKey: string;

  /** Base API URL */
  apiUrl: string;

  /** Zod schema to parse the response */
  schema: z.ZodType<T>;

  /** URL path, e.g. "/api/trends?days=7" */
  path: string;
}): Promise<FetchResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    return { ok: false, error: `API returned ${response.status} ${response.statusText}` };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, error: 'Failed to parse JSON response' };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: `Unexpected response shape: ${result.error.message}` };
  }

  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * Creates and starts the MCP stdio server, registering all AgentMeter tools.
 * Never writes to stdout — the MCP protocol uses stdout exclusively.
 */
async function startMcpServer(): Promise<void> {
  const config = getEffectiveConfig();
  if (!config) {
    process.stderr.write('Error: No API key configured. Run `agentmeter init` first.\n');
    process.exit(1);
  }

  const server = new McpServer(
    { name: 'agentmeter', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // -------------------------------------------------------------------------
  // Tool 1: list_recent_sessions
  // -------------------------------------------------------------------------

  server.tool(
    'list_recent_sessions',
    'List recent local AI coding agent sessions from ~/.agentmeter/sync-state.json. ' +
      'Returns sessions sorted by submission time (newest first). ' +
      'Works without an API key — reads local data only. ' +
      'Use this to quickly see recent activity and costs without a network call.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Maximum number of sessions to return (1–50, default 10)'),
    },
    async ({ limit = 10 }) => {
      const state = readSyncState();
      const entries = Object.entries(state.sessions);

      const sorted = entries
        .sort(([, a], [, b]) => {
          const aTime = a?.submittedAt ?? '';
          const bTime = b?.submittedAt ?? '';
          return bTime.localeCompare(aTime);
        })
        .slice(0, limit)
        .map(([sessionId, s]) => ({
          costCents: s?.costCents ?? null,
          engine: s?.engine ?? null,
          model: s?.model ?? null,
          repoFullName: s?.repoFullName ?? null,
          sessionId,
          startTime: s?.startTime ?? null,
          status: s?.status ?? null,
          submittedAt: s?.submittedAt ?? null,
          title: s?.title ?? null,
        }));

      return textResult({ sessions: sorted, total: entries.length });
    },
  );

  // -------------------------------------------------------------------------
  // Tool 2: get_my_spend
  // -------------------------------------------------------------------------

  server.tool(
    'get_my_spend',
    'Fetch your AgentMeter spend summary and daily time series from the API. ' +
      'Returns total cost, total runs, average cost per run, and a per-day breakdown. ' +
      'Requires a valid API key.',
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Number of days to look back (default 7)'),
    },
    async ({ days = 7 }) => {
      const result = await fetchJson({
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        path: `/api/trends?days=${days}`,
        schema: TrendsResponseSchema,
      });

      if (!result.ok) {
        return textResult({ error: result.error });
      }

      return textResult({
        days,
        summary: {
          avgCostPerRunCents: result.data.summary.avgCostPerRunCents ?? null,
          totalCostCents: result.data.summary.totalCostCents,
          totalRuns: result.data.summary.totalRuns,
        },
        timeSeries: result.data.timeSeries,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Tool 3: get_session
  // -------------------------------------------------------------------------

  server.tool(
    'get_session',
    'Look up a specific session by its ID. ' +
      'Checks local sync state first (fast, no API call); ' +
      'falls back to GET /api/runs/<sessionId> if not found locally. ' +
      'Returns cost, model, engine, status, title, and duration.',
    {
      sessionId: z.string().describe('The session ID to look up'),
    },
    async ({ sessionId }) => {
      const state = readSyncState();
      const local = state.sessions[sessionId];

      if (local) {
        return textResult({
          costCents: local.costCents ?? null,
          engine: local.engine ?? null,
          model: local.model ?? null,
          repoFullName: local.repoFullName ?? null,
          sessionId,
          source: 'local',
          startTime: local.startTime ?? null,
          status: local.status,
          submittedAt: local.submittedAt,
          title: local.title ?? null,
        });
      }

      const result = await fetchJson({
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        path: `/api/runs/${encodeURIComponent(sessionId)}`,
        schema: RunResponseSchema,
      });

      if (!result.ok) {
        return textResult({ error: result.error, sessionId });
      }

      return textResult({
        costCents: result.data.costCents ?? null,
        durationSeconds: result.data.durationSeconds ?? null,
        engine: result.data.engine ?? null,
        model: result.data.model ?? null,
        sessionId: result.data.sessionId,
        source: 'api',
        status: result.data.status ?? null,
        title: result.data.title ?? null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Tool 4: get_team_spend
  // -------------------------------------------------------------------------

  server.tool(
    'get_team_spend',
    'Fetch per-contributor spend breakdown from the AgentMeter API. ' +
      'Returns an array of contributors with total cost, total runs, and connection status. ' +
      'Requires a Pro plan and a valid API key.',
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Number of days to look back (default 30)'),
    },
    async ({ days = 30 }) => {
      const result = await fetchJson({
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        path: `/api/contributors?days=${days}`,
        schema: ContributorsResponseSchema,
      });

      if (!result.ok) {
        return textResult({ error: result.error });
      }

      return textResult({ contributors: result.data, days });
    },
  );

  // -------------------------------------------------------------------------
  // Start server
  // -------------------------------------------------------------------------

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Commander command that starts an MCP stdio server exposing AgentMeter spend data
 */
export const mcpCommand = new Command('mcp')
  .description('Start an MCP stdio server for querying AgentMeter spend data')
  .action(async () => {
    try {
      await startMcpServer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error starting MCP server: ${message}\n`);
      process.exit(1);
    }
  });
