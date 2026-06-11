export type { LocalSession } from '../schemas/session.js';

export interface SessionScanner {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  scan(): Promise<import('../schemas/session.js').LocalSession[]>;
}
