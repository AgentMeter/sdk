import { z } from 'zod';

export const SyncedSessionSchema = z.object({
  status: z.enum(['success', 'failure', 'cancelled']),
  submittedAt: z.string(),
  costCents: z.number().int().nullable().optional(),
});

export const SyncStateSchema = z.object({
  lastSyncAt: z.string().nullable().optional(),
  sessions: z.record(z.string(), SyncedSessionSchema).default({}),
});

export type SyncedSession = z.infer<typeof SyncedSessionSchema>;
export type SyncState = z.infer<typeof SyncStateSchema>;
