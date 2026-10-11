import type { Tokens } from '../schemas/session.js';

/**
 * Sums all four token types into a single total — the same definition the AgentMeter
 * API uses for `totalTokens`
 */
export function sumTokens(tokens: Tokens): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
}
