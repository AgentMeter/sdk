import { z } from 'zod';

export const ValidateKeyResponseSchema = z.object({
  valid: z.boolean(),
  orgName: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  keyType: z.enum(['personal', 'org']).optional(),
});

/** Response from GET /api/auth/me key validation endpoint */
export type ValidateKeyResponse = z.infer<typeof ValidateKeyResponseSchema>;
