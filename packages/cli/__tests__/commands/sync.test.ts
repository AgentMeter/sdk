import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), `agentmeter-test-sync-cmd-${process.pid}`);

vi.mock('../../src/utils/platform.js', () => ({
  getAgentMeterDir: () => tmpDir,
  getConfigPath: () => path.join(tmpDir, 'config.json'),
  getSyncStatePath: () => path.join(tmpDir, 'sync-state.json'),
  getLogDir: () => path.join(tmpDir, 'logs'),
  getLogPath: () => path.join(tmpDir, 'logs', 'sync.log'),
  getClaudeProjectsDir: () => path.join(tmpDir, 'claude-projects'),
  getPlatform: () => 'macos',
}));

// Prevent the Cursor scanner from hitting real system files in tests —
// it would scan the developer's actual Cursor data dir if not mocked.
vi.mock('../../src/scanners/cursor.js', () => ({
  CursorScanner: class {
    readonly name = 'cursor';
    async isAvailable() {
      return false;
    }
    async scan() {
      return [];
    }
  },
}));

vi.mock('../../src/services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setForegroundMode: vi.fn(),
}));

describe('runSync', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Write a valid config
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({
        apiKey: 'am_sk_test',
        deviceName: 'test-device',
        apiUrl: 'https://agentmeter.app',
      }),
      'utf8',
    );
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('returns zero counts when no scanners are available', async () => {
    // No claude projects dir exists, so scanner is unavailable
    const { runSync } = await import('../../src/commands/sync.js');
    const result = await runSync({ verbose: false, dryRun: false });
    expect(result.newCount).toBe(0);
    expect(result.updatedCount).toBe(0);
  });

  it('dry-run returns counts without calling API', async () => {
    // Set up a minimal project dir with one session
    const projectDir = path.join(tmpDir, 'claude-projects', 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'test-session.jsonl'),
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        timestamp: new Date().toISOString(),
        cwd: '/tmp/test',
      })}\n`,
      'utf8',
    );

    vi.stubGlobal('fetch', vi.fn());

    const { runSync } = await import('../../src/commands/sync.js');
    const result = await runSync({ dryRun: true });

    // fetch should NOT have been called in dry-run
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(result.newCount).toBeGreaterThanOrEqual(0);
  });

  it('auto-completes vanished RUNNING sessions on next full sync', async () => {
    // Pre-seed sync state with a RUNNING session that has since vanished from disk
    fs.writeFileSync(
      path.join(tmpDir, 'sync-state.json'),
      JSON.stringify({
        lastSyncAt: new Date().toISOString(),
        sessions: {
          'vanished-session': {
            status: 'running',
            submittedAt: new Date().toISOString(),
            costCents: null,
            endTime: null,
            title: 'Implement dark mode',
            engine: 'claude-code',
            repoFullName: 'org/repo',
            model: 'claude-sonnet-4-5',
            startTime: new Date(Date.now() - 60_000).toISOString(),
          },
        },
      }),
      'utf8',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ sessionId: 'vanished-session', costCents: 0 }),
      }),
    );

    const { runSync } = await import('../../src/commands/sync.js');
    // No claude projects dir — scanner returns nothing, triggering vanished-session logic
    const result = await runSync({ verbose: false });

    expect(result.updatedCount).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();

    // Sync state should now record it as success
    const stateRaw = fs.readFileSync(path.join(tmpDir, 'sync-state.json'), 'utf8');
    const state: unknown = JSON.parse(stateRaw);
    expect(state).toMatchObject({
      sessions: { 'vanished-session': { status: 'success' } },
    });

    // The submitted payload should have status: 'success' and a non-null completedAt
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string,
    ) as unknown;
    expect(body).toMatchObject({ status: 'success' });
    expect((body as { completedAt?: string }).completedAt).toBeTruthy();
  });

  it('submits new sessions and updates sync state', async () => {
    const projectDir = path.join(tmpDir, 'claude-projects', 'my-project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'my-session.jsonl'),
      [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'Build a feature' }] },
          timestamp: '2026-06-08T10:00:00.000Z',
          cwd: '/tmp/my-app',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            usage: {
              input_tokens: 100,
              output_tokens: 200,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            stop_reason: 'end_turn',
          },
          timestamp: '2026-06-08T10:01:00.000Z',
          cwd: '/tmp/my-app',
        }),
      ].join('\n'),
      'utf8',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 201,
        json: async () => ({ sessionId: 'my-session', costCents: 50 }),
      }),
    );

    const { runSync } = await import('../../src/commands/sync.js');
    const result = await runSync({ verbose: false });

    expect(result.newCount).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();

    // Sync state should be updated
    const stateRaw = fs.readFileSync(path.join(tmpDir, 'sync-state.json'), 'utf8');
    const state: unknown = JSON.parse(stateRaw);
    expect(state).toMatchObject({
      sessions: { 'my-session': { status: 'success' } },
    });
  });
});
