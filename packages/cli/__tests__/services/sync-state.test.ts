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

  it('removes completed sessions older than 90 days', async () => {
    const { trimSyncState } = await import('../../src/services/sync-state.js');

    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const result = trimSyncState({
      lastSyncAt: null,
      sessions: {
        'old-sess': { status: 'success', submittedAt: old },
        'recent-sess': { status: 'success', submittedAt: recent },
      },
    });

    expect(result.sessions['old-sess']).toBeUndefined();
    expect(result.sessions['recent-sess']).toBeDefined();
  });

  it('always keeps running sessions regardless of age', async () => {
    const { trimSyncState } = await import('../../src/services/sync-state.js');

    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();

    const result = trimSyncState({
      lastSyncAt: null,
      sessions: {
        'old-running': { status: 'running', submittedAt: old },
        'old-done': { status: 'success', submittedAt: old },
      },
    });

    expect(result.sessions['old-running']).toBeDefined();
    expect(result.sessions['old-done']).toBeUndefined();
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
