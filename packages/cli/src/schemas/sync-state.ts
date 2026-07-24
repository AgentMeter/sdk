import { z } from 'zod';
import { TokensSchema } from './session.js';

export const SyncedSessionSchema = z.object({
  status: z.enum(['running', 'success', 'failure', 'cancelled']),
  submittedAt: z.string(),
  costCents: z.number().int().nullable().optional(),
  endTime: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  /** Stored so vanished RUNNING sessions can be reconstructed and closed on the next full sync */
  engine: z.string().optional(),
  repoFullName: z.string().optional(),
  model: z.string().nullable().optional(),
  startTime: z.string().optional(),
  /** Token counts from the scanner — present for sessions synced after this field was added */
  tokens: TokensSchema.optional(),
});

export const SyncStateSchema = z.object({
  lastSyncAt: z.string().nullable().optional(),
  sessions: z.record(z.string(), SyncedSessionSchema).default({}),
});

/** Persisted record of a session that has been submitted to the API, used to detect re-sync-worthy changes */
export type SyncedSession = z.infer<typeof SyncedSessionSchema>;

/** Contents of the ~/.agentmeter/sync-state.json file */
export type SyncState = z.infer<typeof SyncStateSchema>;
