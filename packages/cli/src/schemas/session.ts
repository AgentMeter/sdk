import { z } from 'zod';

export const TokensSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  /** When true, token counts are estimates rather than exact API-reported values */
  isApproximate: z.boolean().optional(),
});

export const LocalSessionSchema = z.object({
  sessionId: z.string(),
  repoFullName: z.string(),
  engine: z.string(),
  model: z.string().nullable(),
  status: z.enum(['running', 'success', 'failure', 'cancelled']),
  title: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  tokens: TokensSchema,
});

/** Aggregated token counts for a session */
export type Tokens = z.infer<typeof TokensSchema>;

/** Normalized session record produced by a scanner and submitted to the API */
export type LocalSession = z.infer<typeof LocalSessionSchema>;
