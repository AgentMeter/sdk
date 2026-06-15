import { z } from 'zod';

export const SyncedSessionSchema = z.object({
  status: z.enum(['running', 'success', 'failure', 'cancelled']),
  submittedAt: z.string(),
  costCents: z.number().int().nullable().optional(),
  endTime: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
});

export const SyncStateSchema = z.object({
  lastSyncAt: z.string().nullable().optional(),
  sessions: z.record(z.string(), SyncedSessionSchema).default({}),
});

/** Persisted record of a session that has been submitted to the API, used to detect re-sync-worthy changes */
export type SyncedSession = z.infer<typeof SyncedSessionSchema>;

/** Contents of the ~/.agentmeter/sync-state.json file */
export type SyncState = z.infer<typeof SyncStateSchema>;
