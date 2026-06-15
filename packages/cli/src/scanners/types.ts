export type { LocalSession } from '../schemas/session.js';

/**
 * Common contract for all AI coding agent session scanners
 */
export interface SessionScanner {
  /** Human-readable scanner identifier (e.g. "claude", "cursor") */
  readonly name: string;

  /** Returns true if the scanner's data directory exists on this machine */
  isAvailable(): Promise<boolean>;

  /** Scans all available sessions and returns them as normalized LocalSession objects */
  scan(): Promise<import('../schemas/session.js').LocalSession[]>;
}
