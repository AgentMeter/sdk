import fs from 'node:fs';
import os from 'node:os';
import { type Config, ConfigSchema } from '../schemas/config.js';
import { getAgentMeterDir, getConfigPath } from '../utils/platform.js';

/**
 * Reads and validates the config file, returning null if absent or invalid
 */
export function readConfig(): Config | null {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = ConfigSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Validates and writes config to ~/.agentmeter/config.json
 */
export function writeConfig(config: Config): void {
  const agentMeterDir = getAgentMeterDir();
  fs.mkdirSync(agentMeterDir, { recursive: true });

  const validated = ConfigSchema.parse(config);
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  // writeFileSync's mode is only applied when creating a new file — chmod
  // explicitly so a pre-existing, more permissive file also gets locked down.
  // This file contains the API key in plaintext.
  fs.chmodSync(configPath, 0o600);
}

/**
 * Returns the active config, merging env vars over file values.
 * Returns null if no API key is available from either source.
 */
export function getEffectiveConfig(): Config | null {
  const envApiKey = process.env.AGENTMETER_API_KEY;
  const envApiUrl = process.env.AGENTMETER_API_URL;

  const fileConfig = readConfig();

  const apiKey = envApiKey ?? fileConfig?.apiKey;
  if (!apiKey) return null;

  return {
    apiKey,
    deviceName: fileConfig?.deviceName ?? os.hostname(),
    apiUrl: envApiUrl ?? fileConfig?.apiUrl ?? 'https://agentmeter.app',
  };
}
