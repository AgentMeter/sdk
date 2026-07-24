import fs from 'node:fs';
import { type SyncState, SyncStateSchema } from '../schemas/sync-state.js';
import { getAgentMeterDir, getSyncStatePath } from '../utils/platform.js';

/** Sessions older than this (by submittedAt) are eligible for trimming */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Maximum number of completed sessions to retain in sync-state.json.
 * Running sessions are always kept regardless of this cap.
 */
const MAX_COMPLETED_SESSIONS = 5_000;

/**
 * Reads the sync state file, returning an empty state if absent or invalid
 */
export function readSyncState(): SyncState {
  const statePath = getSyncStatePath();

  if (!fs.existsSync(statePath)) {
    return { lastSyncAt: null, sessions: {} };
  }

  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = SyncStateSchema.safeParse(parsed);
    return result.success ? result.data : { lastSyncAt: null, sessions: {} };
  } catch {
    return { lastSyncAt: null, sessions: {} };
  }
}

/**
 * Trims a sync state to remove completed sessions that are older than MAX_AGE_MS
 * or exceed MAX_COMPLETED_SESSIONS (keeping the most recent). Running sessions
 * are always preserved for vanished-session detection.
 *
 * Trimmed sessions may be re-discovered on the next scan and re-submitted to the
 * API, where they will receive a 409 duplicate response that is handled gracefully.
 */
export function trimSyncState(state: SyncState): SyncState {
  const entries = Object.entries(state.sessions);

  const running: typeof entries = [];
  const completed: typeof entries = [];
  for (const entry of entries) {
    if (entry[1]?.status === 'running') {
      running.push(entry);
    } else {
      completed.push(entry);
    }
  }

  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const recent = completed
    .filter(([, s]) => (s?.submittedAt ?? '') >= cutoff)
    .sort(([, a], [, b]) => (b?.submittedAt ?? '').localeCompare(a?.submittedAt ?? ''))
    .slice(0, Math.max(0, MAX_COMPLETED_SESSIONS - running.length));

  return {
    ...state,
    sessions: Object.fromEntries([...running, ...recent]),
  };
}

/**
 * Validates, trims, and writes sync state to ~/.agentmeter/sync-state.json
 */
export function writeSyncState(state: SyncState): void {
  const agentMeterDir = getAgentMeterDir();
  fs.mkdirSync(agentMeterDir, { recursive: true });

  const trimmed = trimSyncState(state);
  const validated = SyncStateSchema.parse(trimmed);
  fs.writeFileSync(getSyncStatePath(), `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}
