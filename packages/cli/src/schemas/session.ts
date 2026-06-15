import { z } from 'zod';

export const TokensSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
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

export type Tokens = z.infer<typeof TokensSchema>;
export type LocalSession = z.infer<typeof LocalSessionSchema>;
