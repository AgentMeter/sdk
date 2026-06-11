import { z } from 'zod';

export const ApiSuccessResponseSchema = z.object({
  sessionId: z.string(),
  costCents: z.number().int().nullable().optional(),
});

export const ValidateKeyResponseSchema = z.object({
  valid: z.boolean(),
  orgName: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  keyType: z.enum(['personal', 'org']).optional(),
});

export type ApiSuccessResponse = z.infer<typeof ApiSuccessResponseSchema>;
export type ValidateKeyResponse = z.infer<typeof ValidateKeyResponseSchema>;
