import { describe, expect, it } from 'vitest';
import { sumTokens } from '../../src/utils/tokens.js';

describe('sumTokens', () => {
  it('sums all four token types', () => {
    expect(sumTokens({ cacheRead: 500, cacheWrite: 100, input: 1000, output: 200 })).toBe(1800);
  });

  it('returns 0 for an empty session', () => {
    expect(sumTokens({ cacheRead: 0, cacheWrite: 0, input: 0, output: 0 })).toBe(0);
  });
});
