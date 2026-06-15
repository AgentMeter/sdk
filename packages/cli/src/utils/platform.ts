import os from 'node:os';
import path from 'node:path';

/**
 * Returns the current user's home directory
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Returns the ~/.agentmeter directory path
 */
export function getAgentMeterDir(): string {
  return path.join(getHomeDir(), '.agentmeter');
}

/**
 * Returns the path to the CLI config file
 */
export function getConfigPath(): string {
  return path.join(getAgentMeterDir(), 'config.json');
}

/**
 * Returns the path to the sync state file
 */
export function getSyncStatePath(): string {
  return path.join(getAgentMeterDir(), 'sync-state.json');
}

/**
 * Returns the directory used for log files
 */
export function getLogDir(): string {
  return path.join(getAgentMeterDir(), 'logs');
}

/**
 * Returns the path to the main sync log file
 */
export function getLogPath(): string {
  return path.join(getLogDir(), 'sync.log');
}

/**
 * Returns the path to Claude Code's projects directory (~/.claude/projects)
 */
export function getClaudeProjectsDir(): string {
  return path.join(getHomeDir(), '.claude', 'projects');
}

/** Normalized platform identifier returned by getPlatform */
export type Platform = 'macos' | 'linux' | 'windows' | 'unsupported';

/**
 * Returns the current platform as a normalized identifier
 */
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
