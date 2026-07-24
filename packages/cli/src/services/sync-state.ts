import fs from 'node:fs';
import { type SyncState, SyncStateSchema } from '../schemas/sync-state.js';
import { getAgentMeterDir, getSyncStatePath } from '../utils/platform.js';

/**
 * Maximum number of completed sessions to retain in sync-state.json.
 * Running sessions are always kept regardless of this cap.
 *
 * No time-based cutoff is applied: the Claude Code scanner re-reads all JSONL
 * files on every run, so age-based trimming would cause old sessions to be
 * re-submitted as "new" on the next sync — generating noise and extra API calls.
 * A count cap is sufficient: at ~500 bytes/entry this allows up to ~2.5 MB,
 * which parses in milliseconds.
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
 * Trims a sync state so it never exceeds MAX_COMPLETED_SESSIONS completed entries.
 * The most recently submitted sessions are kept. Running sessions are always
 * preserved regardless of the cap — they are needed for vanished-session detection.
 *
 * Trimmed sessions may be re-discovered by the scanner and re-submitted. The API
 * is idempotent for known session IDs (it updates rather than duplicates), so
 * re-submissions are safe. The count cap is chosen so re-submissions are rare
 * in practice: a heavy user doing 20 sessions/day takes ~8 months to hit 5,000.
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

  if (completed.length <= MAX_COMPLETED_SESSIONS) {
    return state;
  }

  const kept = completed
    .sort(([, a], [, b]) => (b?.submittedAt ?? '').localeCompare(a?.submittedAt ?? ''))
    .slice(0, Math.max(0, MAX_COMPLETED_SESSIONS - running.length));

  return {
    ...state,
    sessions: Object.fromEntries([...running, ...kept]),
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
