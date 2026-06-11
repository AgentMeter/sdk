import os from 'node:os';
import path from 'node:path';

export function getHomeDir(): string {
  return os.homedir();
}

export function getAgentMeterDir(): string {
  return path.join(getHomeDir(), '.agentmeter');
}

export function getConfigPath(): string {
  return path.join(getAgentMeterDir(), 'config.json');
}

export function getSyncStatePath(): string {
  return path.join(getAgentMeterDir(), 'sync-state.json');
}

export function getLogDir(): string {
  return path.join(getAgentMeterDir(), 'logs');
}

export function getLogPath(): string {
  return path.join(getLogDir(), 'sync.log');
}

export function getClaudeProjectsDir(): string {
  return path.join(getHomeDir(), '.claude', 'projects');
}

export type Platform = 'macos' | 'linux' | 'windows' | 'unsupported';

export function getPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'unsupported';
  }
}
