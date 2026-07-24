import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LocalSession } from '../../src/schemas/session.js';

const tmpDir = path.join(os.tmpdir(), `agentmeter-test-mcp-${process.pid}`);

vi.mock('../../src/utils/platform.js', () => ({
  getAgentMeterDir: () => tmpDir,
  getConfigPath: () => path.join(tmpDir, 'config.json'),
  getSyncStatePath: () => path.join(tmpDir, 'sync-state.json'),
  getLogDir: () => path.join(tmpDir, 'logs'),
  getLogPath: () => path.join(tmpDir, 'logs', 'sync.log'),
  getClaudeProjectsDir: () => path.join(tmpDir, 'claude-projects'),
  getPlatform: () => 'macos',
}));

// ---------------------------------------------------------------------------
// Scanner mocks — populated per-test via claudeSessions / cursorSessions arrays.
// The factory executes lazily (when the mock module is first imported inside a
// test), so by that point these module-level arrays are fully initialised.
// ---------------------------------------------------------------------------

const claudeSessions: LocalSession[] = [];
const cursorSessions: LocalSession[] = [];

vi.mock('../../src/scanners/claude.js', () => ({
  ClaudeScanner: class {
    readonly name = 'claude';
    async isAvailable() {
      return claudeSessions.length > 0;
    }
    async scan() {
      return [...claudeSessions];
    }
  },
}));

vi.mock('../../src/scanners/cursor.js', () => ({
  CursorScanner: class {
    readonly name = 'cursor';
    async isAvailable() {
      return cursorSessions.length > 0;
    }
    async scan() {
      return [...cursorSessions];
    }
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal valid LocalSession */
function makeSession(overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    sessionId: 'sess-default',
    repoFullName: 'org/repo',
    workspacePath: '/tmp/repo',
    engine: 'claude',
    model: 'claude-sonnet',
    status: 'success',
    title: 'Test session',
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    durationSeconds: 120,
    tokens: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 100 },
    turns: 4,
    ...overrides,
  };
}

function writeConfig(): void {
  fs.writeFileSync(
    path.join(tmpDir, 'config.json'),
    JSON.stringify({ apiKey: 'am_sk_test', apiUrl: 'https://agentmeter.app', deviceName: 'test' }),
    'utf8',
  );
}

function writeSyncStateWithCost(sessionId: string, costCents: number): void {
  fs.writeFileSync(
    path.join(tmpDir, 'sync-state.json'),
    JSON.stringify({
      lastSyncAt: null,
      sessions: {
        [sessionId]: { status: 'success', submittedAt: new Date().toISOString(), costCents },
      },
    }),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  claudeSessions.length = 0;
  cursorSessions.length = 0;
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// fetchJson
// ---------------------------------------------------------------------------

describe('fetchJson', () => {
  it('returns ok:true with parsed data on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ value: 42 }),
      }),
    );

    const { fetchJson } = await import('../../src/commands/mcp.js');
    const result = await fetchJson({
      apiKey: 'am_sk_test',
      apiUrl: 'https://agentmeter.app',
      path: '/api/test',
      schema: z.object({ value: z.number() }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ value: 42 });
  });

  it('returns ok:false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { fetchJson } = await import('../../src/commands/mcp.js');
    const result = await fetchJson({
      apiKey: 'am_sk_test',
      apiUrl: 'https://agentmeter.app',
      path: '/api/test',
      schema: z.object({ value: z.number() }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Network error/);
  });

  it('returns ok:false on non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    const { fetchJson } = await import('../../src/commands/mcp.js');
    const result = await fetchJson({
      apiKey: 'am_sk_test',
      apiUrl: 'https://agentmeter.app',
      path: '/api/test',
      schema: z.object({ value: z.number() }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/401/);
  });

  it('returns ok:false when JSON parse fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }),
    );

    const { fetchJson } = await import('../../src/commands/mcp.js');
    const result = await fetchJson({
      apiKey: 'am_sk_test',
      apiUrl: 'https://agentmeter.app',
      path: '/api/test',
      schema: z.object({ value: z.number() }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/parse/i);
  });

  it('returns ok:false when Zod schema mismatch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: 'shape' }),
      }),
    );

    const { fetchJson } = await import('../../src/commands/mcp.js');
    const result = await fetchJson({
      apiKey: 'am_sk_test',
      apiUrl: 'https://agentmeter.app',
      path: '/api/test',
      schema: z.object({ value: z.number() }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unexpected response shape/);
  });
});

// ---------------------------------------------------------------------------
// getLocalSessions
// ---------------------------------------------------------------------------

describe('getLocalSessions', () => {
  it('returns sessions from all available scanners sorted by startTime desc', async () => {
    claudeSessions.push(
      makeSession({ sessionId: 'c1', engine: 'claude', startTime: '2026-06-01T10:00:00.000Z' }),
      makeSession({ sessionId: 'c2', engine: 'claude', startTime: '2026-06-03T10:00:00.000Z' }),
    );
    cursorSessions.push(
      makeSession({ sessionId: 'u1', engine: 'cursor', startTime: '2026-06-02T10:00:00.000Z' }),
    );

    const { getLocalSessions } = await import('../../src/commands/mcp.js');
    const sessions = await getLocalSessions();

    expect(sessions.map((s) => s.sessionId)).toEqual(['c2', 'u1', 'c1']);
  });

  it('returns empty array when no scanners are available', async () => {
    // claudeSessions and cursorSessions are both empty
    const { getLocalSessions } = await import('../../src/commands/mcp.js');
    const sessions = await getLocalSessions();
    expect(sessions).toHaveLength(0);
  });

  it('uses in-memory cache on second call', async () => {
    const scanCallCount = 0;
    claudeSessions.push(makeSession({ sessionId: 'sess-1', startTime: new Date().toISOString() }));

    // Intercept scan by patching the array after first import — reuse scan count trick
    const { getLocalSessions } = await import('../../src/commands/mcp.js');

    const first = await getLocalSessions();
    // Clear the source array — if cache works, second call still returns the same data
    claudeSessions.length = 0;
    const second = await getLocalSessions();

    void scanCallCount; // suppress unused warning
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.sessionId).toBe('sess-1');
  });
});

// ---------------------------------------------------------------------------
// handleListRecentSessions
// ---------------------------------------------------------------------------

describe('handleListRecentSessions', () => {
  it('returns sessions sorted by startTime descending', async () => {
    claudeSessions.push(
      makeSession({ sessionId: 'sess-a', startTime: '2026-06-01T10:00:00.000Z' }),
      makeSession({ sessionId: 'sess-b', startTime: '2026-06-03T10:00:00.000Z' }),
      makeSession({ sessionId: 'sess-c', startTime: '2026-06-02T10:00:00.000Z' }),
    );

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: Array<{ sessionId: string }>;
    };

    expect(parsed.sessions[0]?.sessionId).toBe('sess-b');
    expect(parsed.sessions[1]?.sessionId).toBe('sess-c');
    expect(parsed.sessions[2]?.sessionId).toBe('sess-a');
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      claudeSessions.push(
        makeSession({
          sessionId: `sess-${i}`,
          startTime: new Date(Date.now() - i * 60_000).toISOString(),
        }),
      );
    }

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({ limit: 2 });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: unknown[];
      total: number;
    };

    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.total).toBe(5);
  });

  it('filters out sessions older than 12 months', async () => {
    const recentTime = new Date().toISOString();
    const oldTime = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(); // >12 months

    claudeSessions.push(
      makeSession({ sessionId: 'recent', startTime: recentTime }),
      makeSession({ sessionId: 'old', startTime: oldTime }),
    );

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({ limit: 50 });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: Array<{ sessionId: string }>;
      total: number;
    };

    expect(parsed.sessions.some((s) => s.sessionId === 'recent')).toBe(true);
    expect(parsed.sessions.some((s) => s.sessionId === 'old')).toBe(false);
    expect(parsed.total).toBe(1);
  });

  it('works with no API key configured', async () => {
    claudeSessions.push(makeSession({ sessionId: 'sess-x' }));

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: Array<{ sessionId: string; costCents: null }>;
    };

    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]?.costCents).toBeNull();
  });

  it('enriches costCents from sync-state when available', async () => {
    claudeSessions.push(makeSession({ sessionId: 'sess-rich' }));
    writeSyncStateWithCost('sess-rich', 250);

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: Array<{ sessionId: string; costCents: number | null }>;
    };

    expect(parsed.sessions[0]?.costCents).toBe(250);
  });

  it('returns empty sessions when no scanners are available', async () => {
    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: unknown[];
      total: number;
    };

    expect(parsed.sessions).toHaveLength(0);
    expect(parsed.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleGetMySpend
// ---------------------------------------------------------------------------

describe('handleGetMySpend', () => {
  it('returns hint when no API key is configured', async () => {
    const { handleGetMySpend } = await import('../../src/commands/mcp.js');
    const result = await handleGetMySpend({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      error: string;
      hint: string;
    };

    expect(parsed.error).toMatch(/API key/i);
    expect(parsed.hint).toMatch(/agentmeter/i);
  });

  it('returns spend data when API key is present', async () => {
    writeConfig();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          summary: { totalCostCents: 1234, totalRuns: 7, avgCostPerRunCents: 176 },
          timeSeries: [{ date: '2026-06-01', costCents: 200, runs: 1 }],
        }),
      }),
    );

    const { handleGetMySpend } = await import('../../src/commands/mcp.js');
    const result = await handleGetMySpend({ days: 7 });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      summary: { totalCostCents: number; totalRuns: number };
      days: number;
    };

    expect(parsed.summary.totalCostCents).toBe(1234);
    expect(parsed.days).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// handleGetSession
// ---------------------------------------------------------------------------

describe('handleGetSession', () => {
  it('returns local session without an API call when found by scanner', async () => {
    claudeSessions.push(
      makeSession({
        sessionId: 'local-sess',
        title: 'My local session',
        engine: 'claude',
        model: 'claude-sonnet',
        tokens: { input: 5000, output: 1000, cacheRead: 0, cacheWrite: 0 },
      }),
    );

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const { handleGetSession } = await import('../../src/commands/mcp.js');
    const result = await handleGetSession({ sessionId: 'local-sess' });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessionId: string;
      source: string;
      tokens: { input: number };
    };

    expect(parsed.sessionId).toBe('local-sess');
    expect(parsed.source).toBe('local');
    expect(parsed.tokens.input).toBe(5000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('enriches costCents from sync-state for locally found session', async () => {
    claudeSessions.push(makeSession({ sessionId: 'sess-cost' }));
    writeSyncStateWithCost('sess-cost', 99);

    const { handleGetSession } = await import('../../src/commands/mcp.js');
    const result = await handleGetSession({ sessionId: 'sess-cost' });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      costCents: number | null;
    };

    expect(parsed.costCents).toBe(99);
  });

  it('returns hint when session not found locally and no API key', async () => {
    // No sessions in scanner, no config
    const { handleGetSession } = await import('../../src/commands/mcp.js');
    const result = await handleGetSession({ sessionId: 'unknown-sess' });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      error: string;
      hint: string;
      sessionId: string;
    };

    expect(parsed.error).toMatch(/not found/i);
    expect(parsed.hint).toMatch(/API key/i);
    expect(parsed.sessionId).toBe('unknown-sess');
  });

  it('falls back to API when not found locally and key is configured', async () => {
    writeConfig();
    // No sessions in scanner

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sessionId: 'remote-sess',
          costCents: 42,
          model: 'claude-sonnet',
          engine: 'claude',
          status: 'success',
          title: 'Remote session',
          durationSeconds: 120,
        }),
      }),
    );

    const { handleGetSession } = await import('../../src/commands/mcp.js');
    const result = await handleGetSession({ sessionId: 'remote-sess' });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessionId: string;
      source: string;
      costCents: number;
    };

    expect(parsed.sessionId).toBe('remote-sess');
    expect(parsed.source).toBe('api');
    expect(parsed.costCents).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// handleGetTeamSpend
// ---------------------------------------------------------------------------

describe('handleGetTeamSpend', () => {
  it('returns hint when no API key is configured', async () => {
    const { handleGetTeamSpend } = await import('../../src/commands/mcp.js');
    const result = await handleGetTeamSpend({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      error: string;
      hint: string;
    };

    expect(parsed.error).toMatch(/API key/i);
    expect(parsed.hint).toMatch(/agentmeter/i);
  });

  it('returns contributor data when API key is present', async () => {
    writeConfig();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { login: 'alice', totalCostCents: 500, totalRuns: 10, connectionStatus: 'connected' },
          { login: 'bob', totalCostCents: 200, totalRuns: 4, connectionStatus: 'connected' },
        ],
      }),
    );

    const { handleGetTeamSpend } = await import('../../src/commands/mcp.js');
    const result = await handleGetTeamSpend({ days: 30 });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      contributors: Array<{ login: string }>;
      days: number;
    };

    expect(parsed.contributors).toHaveLength(2);
    expect(parsed.contributors[0]?.login).toBe('alice');
    expect(parsed.days).toBe(30);
  });
});
