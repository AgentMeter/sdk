import { z } from 'zod';

export const ConfigSchema = z.object({
  apiKey: z.string().min(1),
  deviceName: z.string().min(1),
  apiUrl: z.string().url().default('https://agentmeter.app'),
});

export type Config = z.infer<typeof ConfigSchema>;
