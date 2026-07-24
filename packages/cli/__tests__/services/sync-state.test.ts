import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), `agentmeter-test-syncstate-${process.pid}`);
const syncStatePath = path.join(tmpDir, 'sync-state.json');

vi.mock('../../src/utils/platform.js', () => ({
  getAgentMeterDir: () => tmpDir,
  getConfigPath: () => path.join(tmpDir, 'config.json'),
  getSyncStatePath: () => syncStatePath,
  getLogDir: () => path.join(tmpDir, 'logs'),
  getLogPath: () => path.join(tmpDir, 'logs', 'sync.log'),
  getClaudeProjectsDir: () => path.join(tmpDir, 'claude'),
  getPlatform: () => 'macos',
}));

describe('sync-state service', () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readSyncState returns empty state when file does not exist', async () => {
    const { readSyncState } = await import('../../src/services/sync-state.js');
    const state = readSyncState();
    expect(state.sessions).toEqual({});
    expect(state.lastSyncAt).toBeNull();
  });

  it('writeSyncState and readSyncState round-trip', async () => {
    const { writeSyncState, readSyncState } = await import('../../src/services/sync-state.js');

    const state = {
      lastSyncAt: '2026-06-08T14:30:00.000Z',
      sessions: {
        sess_abc123: {
          status: 'success' as const,
          submittedAt: '2026-06-08T14:30:00.000Z',
          costCents: 122,
        },
      },
    };

    writeSyncState(state);
    const read = readSyncState();

    expect(read.lastSyncAt).toBe('2026-06-08T14:30:00.000Z');
    expect(read.sessions.sess_abc123?.status).toBe('success');
    expect(read.sessions.sess_abc123?.costCents).toBe(122);
  });

  it('readSyncState returns empty state for corrupted file', async () => {
    const { readSyncState } = await import('../../src/services/sync-state.js');
    fs.writeFileSync(syncStatePath, '{corrupted json', 'utf8');
    const state = readSyncState();
    expect(state.sessions).toEqual({});
  });

  it('writeSyncState creates directories if needed', async () => {
    const { writeSyncState } = await import('../../src/services/sync-state.js');
    fs.rmSync(tmpDir, { recursive: true, force: true });

    writeSyncState({ lastSyncAt: null, sessions: {} });

    expect(fs.existsSync(syncStatePath)).toBe(true);
  });
});

describe('trimSyncState', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns state unchanged when under the cap', async () => {
    const { trimSyncState } = await import('../../src/services/sync-state.js');

    const state = {
      lastSyncAt: null,
      sessions: {
        s1: { status: 'success' as const, submittedAt: '2026-01-01T00:00:00.000Z' },
        s2: { status: 'success' as const, submittedAt: '2026-01-02T00:00:00.000Z' },
      },
    };

    const result = trimSyncState(state);
    expect(result).toBe(state); // same reference — no copy made
  });

  it('always keeps running sessions regardless of count', async () => {
    const { trimSyncState } = await import('../../src/services/sync-state.js');

    // Build MAX+1 completed sessions plus one running
    const sessions: Record<string, { status: 'success' | 'running'; submittedAt: string }> = {};
    for (let i = 0; i < 5001; i++) {
      sessions[`sess-${i}`] = {
        status: 'success',
        submittedAt: new Date(Date.now() - i * 60_000).toISOString(),
      };
    }
    sessions['running-sess'] = { status: 'running', submittedAt: new Date().toISOString() };

    const { trimSyncState: trim } = await import('../../src/services/sync-state.js');
    const result = trim({ lastSyncAt: null, sessions });

    expect(result.sessions['running-sess']).toBeDefined();
  });

  it('keeps the most recent sessions when count cap is hit', async () => {
    const { trimSyncState } = await import('../../src/services/sync-state.js');

    // Build 5002 recent completed sessions — 2 should be trimmed
    const sessions: Record<string, { status: 'success'; submittedAt: string }> = {};
    for (let i = 0; i < 5002; i++) {
      const ts = new Date(Date.now() - i * 60_000).toISOString(); // 1 min apart, newest first
      sessions[`sess-${i}`] = { status: 'success', submittedAt: ts };
    }

    const result = trimSyncState({ lastSyncAt: null, sessions });
    const kept = Object.keys(result.sessions);

    expect(kept).toHaveLength(5000);
    // The 2 oldest (sess-5000, sess-5001) should be gone
    expect(result.sessions['sess-5000']).toBeUndefined();
    expect(result.sessions['sess-5001']).toBeUndefined();
    // The newest should be kept
    expect(result.sessions['sess-0']).toBeDefined();
  });
});
