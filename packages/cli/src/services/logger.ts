import fs from 'node:fs';
import { getLogDir, getLogPath } from '../utils/platform.js';

type LogLevel = 'info' | 'warn' | 'error';

const MAX_LOG_SIZE = 10 * 1024 * 1024;

let isForeground = true;

export function setForegroundMode(value: boolean): void {
  isForeground = value;
}

function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

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

function writeToFile(message: string): void {
  try {
    ensureLogDir();
    rotateLogs();
    fs.appendFileSync(getLogPath(), `${message}\n`, 'utf8');
  } catch {
    // Silently fail — log file is best-effort
  }
}

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

export const logger = {
  info: (message: string) => log('info', message),
  warn: (message: string) => log('warn', message),
  error: (message: string) => log('error', message),
};
