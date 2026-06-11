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
