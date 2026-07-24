import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

/** Write a sync-state.json into the tmp dir */
function writeSyncState(sessions: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(tmpDir, 'sync-state.json'),
    JSON.stringify({ lastSyncAt: null, sessions }),
    'utf8',
  );
}

/** Write a config.json into the tmp dir */
function writeConfig(): void {
  fs.writeFileSync(
    path.join(tmpDir, 'config.json'),
    JSON.stringify({ apiKey: 'am_sk_test', apiUrl: 'https://agentmeter.app', deviceName: 'test' }),
    'utf8',
  );
}

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
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
        json: async () => ({}),
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
// handleListRecentSessions
// ---------------------------------------------------------------------------

describe('handleListRecentSessions', () => {
  it('returns sessions sorted by submittedAt descending', async () => {
    writeSyncState({
      'sess-a': {
        status: 'success',
        submittedAt: '2026-06-01T10:00:00.000Z',
        title: 'Session A',
        engine: 'claude',
        model: 'claude-sonnet',
        costCents: 10,
      },
      'sess-b': {
        status: 'success',
        submittedAt: '2026-06-03T10:00:00.000Z',
        title: 'Session B',
        engine: 'cursor',
        model: null,
        costCents: 20,
      },
      'sess-c': {
        status: 'success',
        submittedAt: '2026-06-02T10:00:00.000Z',
        title: 'Session C',
        engine: 'claude',
        model: 'claude-opus',
        costCents: 5,
      },
    });

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: Array<{ sessionId: string }>;
      total: number;
    };

    expect(parsed.total).toBe(3);
    expect(parsed.sessions[0]?.sessionId).toBe('sess-b');
    expect(parsed.sessions[1]?.sessionId).toBe('sess-c');
    expect(parsed.sessions[2]?.sessionId).toBe('sess-a');
  });

  it('respects the limit parameter', async () => {
    writeSyncState({
      s1: { status: 'success', submittedAt: '2026-01-01T00:00:00.000Z' },
      s2: { status: 'success', submittedAt: '2026-01-02T00:00:00.000Z' },
      s3: { status: 'success', submittedAt: '2026-01-03T00:00:00.000Z' },
      s4: { status: 'success', submittedAt: '2026-01-04T00:00:00.000Z' },
      s5: { status: 'success', submittedAt: '2026-01-05T00:00:00.000Z' },
    });

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({ limit: 2 });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessions: unknown[];
      total: number;
    };

    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.total).toBe(5);
  });

  it('works with no API key configured', async () => {
    // No config.json written — but it should still work
    writeSyncState({ 'sess-x': { status: 'success', submittedAt: '2026-01-01T00:00:00.000Z' } });

    const { handleListRecentSessions } = await import('../../src/commands/mcp.js');
    const result = await handleListRecentSessions({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { sessions: unknown[] };

    expect(parsed.sessions).toHaveLength(1);
  });

  it('returns empty list when sync-state is absent', async () => {
    // No sync-state.json — readSyncState() returns empty state
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
    expect(parsed.summary.totalRuns).toBe(7);
    expect(parsed.days).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// handleGetSession
// ---------------------------------------------------------------------------

describe('handleGetSession', () => {
  it('returns local session without an API call when found in sync state', async () => {
    writeSyncState({
      'local-sess': {
        status: 'success',
        submittedAt: '2026-06-01T10:00:00.000Z',
        costCents: 99,
        title: 'Local session',
        engine: 'claude',
        model: 'claude-sonnet',
        startTime: '2026-06-01T09:55:00.000Z',
        repoFullName: 'org/repo',
      },
    });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const { handleGetSession } = await import('../../src/commands/mcp.js');
    const result = await handleGetSession({ sessionId: 'local-sess' });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      sessionId: string;
      source: string;
      costCents: number;
    };

    expect(parsed.sessionId).toBe('local-sess');
    expect(parsed.source).toBe('local');
    expect(parsed.costCents).toBe(99);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns hint when session not found locally and no API key', async () => {
    writeSyncState({}); // empty

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

  it('falls back to API when session not found locally and key is configured', async () => {
    writeConfig();
    writeSyncState({}); // empty

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
      contributors: Array<{ login: string; totalCostCents: number }>;
      days: number;
    };

    expect(parsed.contributors).toHaveLength(2);
    expect(parsed.contributors[0]?.login).toBe('alice');
    expect(parsed.days).toBe(30);
  });
});
