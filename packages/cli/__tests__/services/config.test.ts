import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), `agentmeter-test-config-${process.pid}`);
const configPath = path.join(tmpDir, 'config.json');

vi.mock('../../src/utils/platform.js', () => ({
  getAgentMeterDir: () => tmpDir,
  getConfigPath: () => configPath,
  getSyncStatePath: () => path.join(tmpDir, 'sync-state.json'),
  getLogDir: () => path.join(tmpDir, 'logs'),
  getLogPath: () => path.join(tmpDir, 'logs', 'sync.log'),
  getClaudeProjectsDir: () => path.join(tmpDir, 'claude'),
  getPlatform: () => 'macos',
}));

describe('config service', () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('readConfig returns null when file does not exist', async () => {
    const { readConfig } = await import('../../src/services/config.js');
    expect(readConfig()).toBeNull();
  });

  it('writeConfig and readConfig round-trip', async () => {
    const { writeConfig, readConfig } = await import('../../src/services/config.js');
    const config = {
      apiKey: 'am_sk_test',
      deviceName: 'test-device',
      apiUrl: 'https://agentmeter.app',
    };

    writeConfig(config);
    const read = readConfig();

    expect(read).toEqual(config);
  });

  it('readConfig returns null for invalid JSON', async () => {
    const { readConfig } = await import('../../src/services/config.js');
    fs.writeFileSync(configPath, 'not json', 'utf8');
    expect(readConfig()).toBeNull();
  });

  it('readConfig returns null for missing required fields', async () => {
    const { readConfig } = await import('../../src/services/config.js');
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: '' }), 'utf8');
    expect(readConfig()).toBeNull();
  });

  it('getEffectiveConfig returns null when no key available', async () => {
    const { getEffectiveConfig } = await import('../../src/services/config.js');
    expect(getEffectiveConfig()).toBeNull();
  });

  it('getEffectiveConfig uses AGENTMETER_API_KEY env var', async () => {
    vi.stubEnv('AGENTMETER_API_KEY', 'am_sk_from_env');
    const { getEffectiveConfig } = await import('../../src/services/config.js');
    const config = getEffectiveConfig();
    expect(config?.apiKey).toBe('am_sk_from_env');
  });

  it('getEffectiveConfig env var overrides file config', async () => {
    const { writeConfig, getEffectiveConfig } = await import('../../src/services/config.js');
    writeConfig({
      apiKey: 'am_sk_file',
      deviceName: 'my-device',
      apiUrl: 'https://agentmeter.app',
    });

    vi.stubEnv('AGENTMETER_API_KEY', 'am_sk_env');
    const config = getEffectiveConfig();
    expect(config?.apiKey).toBe('am_sk_env');
    expect(config?.deviceName).toBe('my-device');
  });
});
