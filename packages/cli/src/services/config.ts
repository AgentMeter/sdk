import fs from 'node:fs';
import os from 'node:os';
import { type Config, ConfigSchema } from '../schemas/config.js';
import { getAgentMeterDir, getConfigPath } from '../utils/platform.js';

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

export function writeConfig(config: Config): void {
  const agentMeterDir = getAgentMeterDir();
  fs.mkdirSync(agentMeterDir, { recursive: true });

  const validated = ConfigSchema.parse(config);
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}

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
