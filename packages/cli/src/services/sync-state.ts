import fs from 'node:fs';
import { type SyncState, SyncStateSchema } from '../schemas/sync-state.js';
import { getAgentMeterDir, getSyncStatePath } from '../utils/platform.js';

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
 * Validates and writes sync state to ~/.agentmeter/sync-state.json
 */
export function writeSyncState(state: SyncState): void {
  const agentMeterDir = getAgentMeterDir();
  fs.mkdirSync(agentMeterDir, { recursive: true });

  const validated = SyncStateSchema.parse(state);
  fs.writeFileSync(getSyncStatePath(), `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}
