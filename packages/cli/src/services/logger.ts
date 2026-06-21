import fs from 'node:fs';
import { getLogDir, getLogPath } from '../utils/platform.js';

/** Severity levels for log entries */
type LogLevel = 'info' | 'warn' | 'error';

const MAX_LOG_SIZE = 10 * 1024 * 1024;

let isForeground = true;

/**
 * Controls whether log output is written to stdout/stderr in addition to the log file
 */
export function setForegroundMode(value: boolean): void {
  isForeground = value;
}

/**
 * Creates the log directory if it does not already exist
 */
function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Rotates the log file to .log.1 when it exceeds MAX_LOG_SIZE
 */
function rotateLogs(): void {
  const logPath = getLogPath();
  try {
    const stat = fs.statSync(logPath);
    if (stat.size > MAX_LOG_SIZE) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {
    // File doesn't exist yet — nothing to rotate
  }
}

/**
 * Appends a message to the log file, rotating if needed
 */
function writeToFile(message: string): void {
  try {
    ensureLogDir();
    rotateLogs();
    fs.appendFileSync(getLogPath(), `${message}\n`, 'utf8');
  } catch {
    // Silently fail — log file is best-effort
  }
}

/**
 * Writes a timestamped log entry to file and optionally to stdout/stderr
 */
function log(level: LogLevel, message: string): void {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} [${level.toUpperCase()}] ${message}`;

  writeToFile(entry);

  if (isForeground) {
    if (level === 'error') {
      process.stderr.write(`${entry}\n`);
    } else {
      process.stdout.write(`${entry}\n`);
    }
  }
}

/**
 * Writes timestamped log entries to the AgentMeter log file, mirroring to
 * stdout/stderr unless foreground mode has been disabled
 */
export const logger = {
  info: (message: string): void => log('info', message),
  warn: (message: string): void => log('warn', message),
  error: (message: string): void => log('error', message),
};
