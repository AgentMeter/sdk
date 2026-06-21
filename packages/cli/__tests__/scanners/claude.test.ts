import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScanner } from '../../src/scanners/claude.js';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(thisDir, '..', 'fixtures', 'claude-sessions');

vi.mock('../../src/utils/platform.js', () => ({
  getClaudeProjectsDir: () => fixturesDir,
  getLogDir: () => '/tmp/agentmeter-test/logs',
  getLogPath: () => '/tmp/agentmeter-test/logs/sync.log',
}));

vi.mock('../../src/utils/repo.js', () => ({
  resolveRepoFullName: (dir: string) => path.basename(dir),
}));

// Silence logger output during tests
vi.mock('../../src/services/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  setForegroundMode: vi.fn(),
}));

describe('ClaudeScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports as available when ~/.claude/projects exists', async () => {
    const scanner = new ClaudeScanner();
    const available = await scanner.isAvailable();
    expect(available).toBe(true);
  });

  it('scans valid session and returns correct data', async () => {
    const scanner = new ClaudeScanner();
    const sessions = await scanner.scan();

    const valid = sessions.find((s) => s.sessionId === 'session');
    // The fixture dir "valid-session" contains "session.jsonl" → sessionId = "session"
    expect(sessions.length).toBeGreaterThan(0);

    // resolveRepoFullName is mocked to return path.basename(cwd), so cwd /tmp/test-project → test-project
    const validSession = sessions.find((s) => s.repoFullName === 'test-project');
    expect(validSession).toBeDefined();

    if (validSession) {
      expect(validSession.engine).toBe('claude');
      expect(validSession.model).toBe('claude-sonnet-4-5');
      expect(validSession.title).toBe('Implement the login page with OAuth');
      expect(validSession.status).toBe('success');
      expect(validSession.tokens.input).toBe(250); // 100 + 150
      expect(validSession.tokens.output).toBe(450); // 200 + 250
      expect(validSession.tokens.cacheRead).toBe(50); // 0 + 50
      expect(validSession.tokens.cacheWrite).toBe(50); // 50 + 0
      expect(validSession.startTime).toBe('2026-06-08T14:00:00.000Z');
      expect(validSession.endTime).toBe('2026-06-08T14:01:45.000Z');
      expect(validSession.durationSeconds).toBe(105); // 1m 45s
      expect(validSession.turns).toBe(2); // 2 user entries
    }
  });

  it('handles malformed JSONL gracefully without crashing', async () => {
    const scanner = new ClaudeScanner();
    // Should not throw even with invalid JSON lines
    const sessions = await scanner.scan();
    expect(Array.isArray(sessions)).toBe(true);

    const malformed = sessions.find((s) => s.repoFullName === 'test-project-2');
    // The valid lines in the malformed fixture should still be parsed
    expect(malformed).toBeDefined();
    if (malformed) {
      expect(malformed.title).toBe('Do something useful');
      // input_tokens was "not-a-number" → caught → defaults to 0
      expect(malformed.tokens.input).toBe(0);
      expect(malformed.tokens.output).toBe(100);
      expect(malformed.turns).toBe(1); // 1 user entry
    }
  });

  it('skips empty session files', async () => {
    const scanner = new ClaudeScanner();
    const sessions = await scanner.scan();
    // The empty-session/session.jsonl file should produce no session
    const emptySessions = sessions.filter((s) => s.repoFullName === 'empty-session');
    expect(emptySessions.length).toBe(0);
  });

  it('name is "claude"', () => {
    const scanner = new ClaudeScanner();
    expect(scanner.name).toBe('claude');
  });
});
