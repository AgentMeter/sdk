import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { USER_AGENT } from '../../src/utils/user-agent.js';

describe('USER_AGENT', () => {
  it('identifies the CLI and its package version', () => {
    expect(USER_AGENT).toBe(`agentmeter-cli/${pkg.version}`);
  });
});
