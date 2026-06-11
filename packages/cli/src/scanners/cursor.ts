import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LocalSession } from '../schemas/session.js';
import { logger } from '../services/logger.js';
import type { SessionScanner } from './types.js';

function getCursorDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor');
  }
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config', 'Cursor');
  }
  return path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor');
}

export class CursorScanner implements SessionScanner {
  readonly name = 'cursor';

  async isAvailable(): Promise<boolean> {
    try {
      return fs.statSync(getCursorDataDir()).isDirectory();
    } catch {
      return false;
    }
  }

  async scan(): Promise<LocalSession[]> {
    logger.info('Cursor support coming soon — skipping');
    return [];
  }
}
