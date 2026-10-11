import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Command } from 'commander';
import { z } from 'zod';
import { ClaudeScanner } from '../scanners/claude.js';
import { CursorScanner } from '../scanners/cursor.js';
import type { LocalSession } from '../schemas/session.js';
import { getEffectiveConfig } from '../services/config.js';
import { readSyncState } from '../services/sync-state.js';
import { sumTokens } from '../utils/tokens.js';
import { USER_AGENT } from '../utils/user-agent.js';

// ---------------------------------------------------------------------------
// Zod schemas for API response validation
// ---------------------------------------------------------------------------

const TrendsSummarySchema = z.object({
  avgTokensPerRun: z.number(),
  cacheHitRate: z.number().nullable().optional(),
  totalRuns: z.number(),
  totalTokens: z.number(),
});

const TimeSeriesItemSchema = z.object({
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  date: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  runCount: z.number(),
  totalTokens: z.number(),
});

const TrendsResponseSchema = z.object({
  summary: TrendsSummarySchema,
  timeSeries: z.array(TimeSeriesItemSchema),
});

const ContributorSchema = z.object({
  avgTokensPerRun: z.number(),
  connectionStatus: z.string().optional(),
  githubLogin: z.string(),
  lastActivityAt: z.string().nullable().optional(),
  runCount: z.number(),
  tokenShareFraction: z.number(),
  totalTokens: z.number(),
});

const ContributorsResponseSchema = z.object({
  contributors: z.array(ContributorSchema),
});

const RunResponseSchema = z.object({
  completedAt: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  engine: z.string().optional(),
  id: z.string(),
  localSessionId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  repo: z.object({ fullName: z.string() }).nullable().optional(),
  startedAt: z.string().optional(),
  status: z.string().optional(),
  title: z.string().nullable().optional(),
  tokens: z
    .object({
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      inputTokens: z.number(),
      isApproximate: z.boolean().optional(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .nullable()
    .optional(),
  turns: z.number().nullable().optional(),
});

/** The API clamps `days` to this range on /api/trends and /api/contributors */
const API_MIN_DAYS = 7;
const API_MAX_DAYS = 90;

/**
 * Clamps a requested look-back window to the range the API actually serves
 */
function clampDays(days: number): number {
  return Math.min(API_MAX_DAYS, Math.max(API_MIN_DAYS, days));
}

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
 * Reads sync-state and returns the set of session IDs already submitted to AgentMeter.
 * Returns an empty set if sync-state is absent or unreadable.
 */
function readSyncedIds(): Set<string> {
  try {
    return new Set(Object.keys(readSyncState().sessions));
  } catch {
    return new Set();
  }
}

/**
 * Shapes a locally scanned session for MCP output
 */
function toLocalSessionResult({
  session,
  syncedIds,
}: {
  /** Session from a local scanner */
  session: LocalSession;
  /** Session IDs already submitted to AgentMeter */
  syncedIds: Set<string>;
}): Record<string, unknown> {
  return {
    durationSeconds: session.durationSeconds,
    endTime: session.endTime,
    engine: session.engine,
    model: session.model,
    repoFullName: session.repoFullName,
    sessionId: session.sessionId,
    startTime: session.startTime,
    status: session.status,
    synced: syncedIds.has(session.sessionId),
    title: session.title,
    tokens: session.tokens,
    totalTokens: sumTokens(session.tokens),
    turns: session.turns,
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
        'User-Agent': USER_AGENT,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === 'object' &&
        typeof (body as { error?: unknown }).error === 'string'
      ) {
        detail = `: ${(body as { error: string }).error}`;
      }
    } catch {
      // Error body is optional
    }
    return {
      ok: false,
      error: `API returned ${response.status} ${response.statusText}${detail}`,
    };
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
 * `synced` reflects whether the session has been submitted to AgentMeter.
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

  const syncedIds = readSyncedIds();
  const sessions = recent
    .slice(0, limit)
    .map((session) => toLocalSessionResult({ session, syncedIds }));

  return textResult({ sessions, total: recent.length });
}

/**
 * Fetches token usage summary and daily time series for the last `days` days.
 * Requires a Pro plan and a valid AgentMeter API key.
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

  const effectiveDays = clampDays(days);
  const result = await fetchJson({
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    path: `/api/trends?days=${effectiveDays}`,
    schema: TrendsResponseSchema,
  });

  if (!result.ok) {
    return textResult({ error: result.error });
  }

  return textResult({
    days: effectiveDays,
    summary: {
      avgTokensPerRun: result.data.summary.avgTokensPerRun,
      cacheHitRate: result.data.summary.cacheHitRate ?? null,
      totalRuns: result.data.summary.totalRuns,
      totalTokens: result.data.summary.totalTokens,
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
    return textResult({
      ...toLocalSessionResult({ session: local, syncedIds: readSyncedIds() }),
      source: 'local',
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

  const run = result.data;
  return textResult({
    durationSeconds: run.durationSeconds ?? null,
    endTime: run.completedAt ?? null,
    engine: run.engine ?? null,
    model: run.model ?? null,
    repoFullName: run.repo?.fullName ?? null,
    runId: run.id,
    sessionId: run.localSessionId ?? run.id,
    source: 'api',
    startTime: run.startedAt ?? null,
    status: run.status?.toLowerCase() ?? null,
    title: run.title ?? null,
    tokens: run.tokens
      ? {
          cacheRead: run.tokens.cacheReadTokens,
          cacheWrite: run.tokens.cacheWriteTokens,
          input: run.tokens.inputTokens,
          isApproximate: run.tokens.isApproximate ?? false,
          output: run.tokens.outputTokens,
        }
      : null,
    totalTokens: run.tokens?.totalTokens ?? null,
    turns: run.turns ?? null,
  });
}

/**
 * Fetches per-contributor token usage breakdown. Requires a Pro plan and a valid API key.
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

  const effectiveDays = clampDays(days);
  const result = await fetchJson({
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    path: `/api/contributors?days=${effectiveDays}&sortBy=totalTokens`,
    schema: ContributorsResponseSchema,
  });

  if (!result.ok) {
    return textResult({ error: result.error });
  }

  const contributors = result.data.contributors.map((c) => ({
    avgTokensPerRun: c.avgTokensPerRun,
    connectionStatus: c.connectionStatus ?? null,
    lastActivityAt: c.lastActivityAt ?? null,
    login: c.githubLogin,
    runCount: c.runCount,
    tokenShareFraction: c.tokenShareFraction,
    totalTokens: c.totalTokens,
  }));

  return textResult({ contributors, days: effectiveDays });
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
      'No API key required. Includes token counts (input/output/cache) plus totalTokens, duration, turns, and model. ' +
      '`synced` is true when the session has been submitted to AgentMeter (agentmeter.app). ' +
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
    'Fetch your AgentMeter token usage summary and daily time series from the API. ' +
      'Returns total tokens, total runs, average tokens per run, cache hit rate, and a per-day token breakdown by type. ' +
      'The API serves 7–90 days; other values are clamped. ' +
      'Requires a Pro plan and an AgentMeter API key (https://agentmeter.app). ' +
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
      'Returns tokens (by type and total), model, engine, status, title, turns, and duration.',
    {
      sessionId: z.string().describe('The session ID to look up'),
    },
    async ({ sessionId }) => handleGetSession({ sessionId }),
  );

  server.tool(
    'get_team_spend',
    'Fetch per-contributor token usage from the AgentMeter API. ' +
      'Returns contributors sorted by total tokens, with runs, average tokens per run, share of team tokens, and connection status. ' +
      'The API serves 7–90 days; other values are clamped. ' +
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
    'Show your AI coding token usage summary and daily breakdown (requires AgentMeter Pro)',
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
              text: `Here is my AI coding token usage for the last ${daysNum} day${daysNum === 1 ? '' : 's'}:\n\n${data}\n\nPlease summarise my token usage trends, highlight any notable spikes or patterns, comment on the cache hit rate, and give me a sense of whether my usage is tracking high or low.`,
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
 * Commander command that starts an MCP stdio server exposing AgentMeter token usage data
 */
export const mcpCommand = new Command('mcp')
  .description('Start an MCP stdio server for querying AgentMeter token usage')
  .action(async () => {
    try {
      await startMcpServer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error starting MCP server: ${message}\n`);
      process.exit(1);
    }
  });
