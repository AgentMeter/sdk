import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Command } from 'commander';
import { z } from 'zod';
import { ClaudeScanner } from '../scanners/claude.js';
import { CursorScanner } from '../scanners/cursor.js';
import type { LocalSession } from '../schemas/session.js';
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
// Local session scanning — with in-memory cache
// ---------------------------------------------------------------------------

/** Sessions older than this are excluded from list_recent_sessions results */
const LIST_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 12 months

/** How long to reuse a scan result before re-scanning */
const SCAN_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * In-memory cache of the last scan result.
 * Lives for the lifetime of the MCP server process (one per client connection).
 */
interface SessionScanCache {
  /** Timestamp when this cache entry was populated */
  cachedAt: number;
  /** All sessions found across all available scanners, sorted by startTime descending */
  sessions: LocalSession[];
}

let sessionScanCache: SessionScanCache | null = null;

/**
 * Runs all available scanners and returns their combined results sorted by
 * startTime descending. Results are cached in memory for SCAN_CACHE_TTL_MS —
 * subsequent calls within the TTL window skip the scan and return immediately.
 * Scanner failures are caught individually so one broken scanner never blocks another.
 */
export async function getLocalSessions(): Promise<LocalSession[]> {
  if (sessionScanCache !== null && Date.now() - sessionScanCache.cachedAt < SCAN_CACHE_TTL_MS) {
    return sessionScanCache.sessions;
  }

  const scanners = [new ClaudeScanner(), new CursorScanner()];
  const all: LocalSession[] = [];

  for (const scanner of scanners) {
    try {
      if (!(await scanner.isAvailable())) continue;
      const found = await scanner.scan();
      all.push(...found);
    } catch {
      // One scanner failing should not prevent results from others
    }
  }

  all.sort((a, b) => b.startTime.localeCompare(a.startTime));

  sessionScanCache = { cachedAt: Date.now(), sessions: all };
  return all;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NO_API_KEY_HINT =
  'Run `agentmeter init` to configure your API key, or set the AGENTMETER_API_KEY env var. ' +
  'Sign up free at https://agentmeter.app';

/**
 * Serialises a value as a plain text MCP tool result
 */
function textResult(value: unknown): { content: [{ text: string; type: 'text' }] } {
  return {
    content: [{ text: JSON.stringify(value, null, 2), type: 'text' as const }],
  };
}

/**
 * Reads sync-state and returns a sessionId → costCents map.
 * Returns an empty object if sync-state is absent or unreadable.
 * costCents is only present for sessions that have been submitted to AgentMeter.
 */
function readCostMap(): Record<string, number | null> {
  try {
    const state = readSyncState();
    const map: Record<string, number | null> = {};
    for (const [id, s] of Object.entries(state.sessions)) {
      map[id] = s?.costCents ?? null;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Discriminated result from fetchJson — either successful with data or failed with an error message
 */
type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Returns a Bearer-authed fetch result, parsed through the given Zod schema.
 * On any failure returns `{ ok: false, error }` instead of throwing.
 */
export async function fetchJson<T>({
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
// Tool handlers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Scans local Claude Code and Cursor data and returns the most recent sessions.
 * Results are filtered to the last 12 months and limited to `limit` entries.
 * costCents is enriched from sync-state when available (requires AgentMeter account).
 * No API key required.
 */
export async function handleListRecentSessions({
  limit = 10,
}: {
  /** Maximum number of sessions to return (1–50) */
  limit?: number;
}): Promise<ReturnType<typeof textResult>> {
  let all: LocalSession[];
  try {
    all = await getLocalSessions();
  } catch (err) {
    return textResult({
      error: `Failed to scan local sessions: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const cutoff = new Date(Date.now() - LIST_MAX_AGE_MS).toISOString();
  const recent = all.filter((s) => s.startTime >= cutoff);

  const costMap = readCostMap();

  const sessions = recent.slice(0, limit).map((s) => ({
    costCents: costMap[s.sessionId] ?? null,
    durationSeconds: s.durationSeconds,
    endTime: s.endTime,
    engine: s.engine,
    model: s.model,
    repoFullName: s.repoFullName,
    sessionId: s.sessionId,
    startTime: s.startTime,
    status: s.status,
    title: s.title,
    tokens: s.tokens,
    turns: s.turns,
  }));

  return textResult({ sessions, total: recent.length });
}

/**
 * Fetches spend summary and daily time series for the last `days` days.
 * Requires a valid AgentMeter API key.
 */
export async function handleGetMySpend({
  days = 7,
}: {
  /** Number of days to look back */
  days?: number;
}): Promise<ReturnType<typeof textResult>> {
  const config = getEffectiveConfig();
  if (!config) {
    return textResult({ error: 'AgentMeter API key required', hint: NO_API_KEY_HINT });
  }

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
}

/**
 * Looks up a session by ID. Checks live local scan first (no API key required);
 * if not found and an API key is configured, falls back to GET /api/runs/<sessionId>.
 */
export async function handleGetSession({
  sessionId,
}: {
  /** Session ID to look up */
  sessionId: string;
}): Promise<ReturnType<typeof textResult>> {
  let all: LocalSession[];
  try {
    all = await getLocalSessions();
  } catch (err) {
    return textResult({
      error: `Failed to scan local sessions: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const local = all.find((s) => s.sessionId === sessionId);

  if (local) {
    const costMap = readCostMap();
    return textResult({
      costCents: costMap[sessionId] ?? null,
      durationSeconds: local.durationSeconds,
      endTime: local.endTime,
      engine: local.engine,
      model: local.model,
      repoFullName: local.repoFullName,
      sessionId: local.sessionId,
      source: 'local',
      startTime: local.startTime,
      status: local.status,
      title: local.title,
      tokens: local.tokens,
      turns: local.turns,
    });
  }

  const config = getEffectiveConfig();
  if (!config) {
    return textResult({
      error: 'Session not found in local data',
      hint: `Configure an API key to enable remote session lookup. ${NO_API_KEY_HINT}`,
      sessionId,
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
}

/**
 * Fetches per-contributor spend breakdown. Requires a Pro plan and a valid API key.
 */
export async function handleGetTeamSpend({
  days = 30,
}: {
  /** Number of days to look back */
  days?: number;
}): Promise<ReturnType<typeof textResult>> {
  const config = getEffectiveConfig();
  if (!config) {
    return textResult({ error: 'AgentMeter API key required', hint: NO_API_KEY_HINT });
  }

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
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

/**
 * Creates and starts the MCP stdio server, registering all AgentMeter tools.
 * Never writes to stdout — the MCP protocol uses stdout exclusively.
 * Local tools scan Claude Code and Cursor data on demand (no prior setup required).
 * API tools return a structured error + sign-up hint when no key is configured.
 */
async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: 'agentmeter', version: '1.0.0' },
    { capabilities: { prompts: {}, tools: {} } },
  );

  server.tool(
    'list_recent_sessions',
    'List recent AI coding sessions scanned live from Claude Code and Cursor on this machine. ' +
      'Returns sessions from the last 12 months sorted by start time (newest first). ' +
      'No API key required. Includes token counts (input/output/cache), duration, and model. ' +
      'Cost in cents is included when sessions have been synced to AgentMeter (agentmeter.app). ' +
      'The first call may take a moment to scan local data; subsequent calls within 60 seconds are instant.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Maximum number of sessions to return (1–50, default 10)'),
    },
    async ({ limit = 10 }) => handleListRecentSessions({ limit }),
  );

  server.tool(
    'get_my_spend',
    'Fetch your AgentMeter spend summary and daily time series from the API. ' +
      'Returns total cost, total runs, average cost per run, and a per-day breakdown. ' +
      'Requires an AgentMeter API key (free tier available at https://agentmeter.app). ' +
      'If no key is configured, returns instructions on how to set one up.',
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Number of days to look back (default 7)'),
    },
    async ({ days = 7 }) => handleGetMySpend({ days }),
  );

  server.tool(
    'get_session',
    'Look up a specific AI coding session by ID. ' +
      'Checks local Claude Code and Cursor data first (no API key needed); ' +
      'falls back to the AgentMeter API if not found locally (requires API key). ' +
      'Returns cost, model, engine, status, title, tokens, and duration.',
    {
      sessionId: z.string().describe('The session ID to look up'),
    },
    async ({ sessionId }) => handleGetSession({ sessionId }),
  );

  server.tool(
    'get_team_spend',
    'Fetch per-contributor spend breakdown from the AgentMeter API. ' +
      'Returns an array of contributors with total cost, total runs, and connection status. ' +
      'Requires a Pro plan and a valid AgentMeter API key. ' +
      'If no key is configured, returns instructions on how to set one up.',
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Number of days to look back (default 30)'),
    },
    async ({ days = 30 }) => handleGetTeamSpend({ days }),
  );

  // -------------------------------------------------------------------------
  // Prompts — surfaced as slash commands in MCP clients (e.g. /mcp__agentmeter__sessions)
  // -------------------------------------------------------------------------

  server.prompt(
    'sessions',
    'Show your recent AI coding sessions — token usage, duration, model, and repo',
    {
      limit: z.string().optional().describe('Number of sessions to show (1–50, default 10)'),
    },
    async ({ limit }) => {
      const limitNum = limit ? Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 10)) : 10;
      const result = await handleListRecentSessions({ limit: limitNum });
      const data = result.content[0]?.text ?? '{}';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Here are my ${limitNum} most recent AI coding sessions:\n\n${data}\n\nPlease summarise what I have been working on, call out any sessions that used an unusually high number of tokens, and give me the total token count across all sessions shown.`,
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'spend',
    'Show your AI coding spend summary and daily breakdown (requires AgentMeter account)',
    {
      days: z.string().optional().describe('Number of days to look back (default 7)'),
    },
    async ({ days }) => {
      const daysNum = days ? Math.min(365, Math.max(1, Number.parseInt(days, 10) || 7)) : 7;
      const result = await handleGetMySpend({ days: daysNum });
      const data = result.content[0]?.text ?? '{}';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Here is my AI coding spend data for the last ${daysNum} day${daysNum === 1 ? '' : 's'}:\n\n${data}\n\nPlease summarise my spending trends, highlight any notable spikes or patterns, and give me a sense of whether my usage is tracking high or low.`,
            },
          },
        ],
      };
    },
  );

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
