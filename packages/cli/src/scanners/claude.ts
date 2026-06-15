import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { LocalSession } from '../schemas/session.js';
import { logger } from '../services/logger.js';
import { getClaudeProjectsDir } from '../utils/platform.js';
import { resolveRepoFullName } from '../utils/repo.js';
import type { SessionScanner } from './types.js';

// Permissive schemas for undocumented JSONL format — .catch() ensures a bad field
// never fails the whole line parse.
const UsageSchema = z.object({
  input_tokens: z.number().catch(0),
  output_tokens: z.number().catch(0),
  cache_creation_input_tokens: z.number().catch(0),
  cache_read_input_tokens: z.number().catch(0),
});

const ContentBlockSchema = z
  .object({ type: z.string().optional(), text: z.string().optional() })
  .passthrough();

const MessageSchema = z
  .object({
    role: z.string().optional(),
    model: z.string().optional(),
    usage: UsageSchema.optional(),
    content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
    stop_reason: z.string().optional(),
  })
  .passthrough();

const JournalEntrySchema = z
  .object({
    type: z.string().optional(),
    sessionId: z.string().optional(),
    uuid: z.string().optional(),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    aiTitle: z.string().optional(),
    message: MessageSchema.optional(),
  })
  .passthrough();

type JournalEntry = z.infer<typeof JournalEntrySchema>;

/**
 * Reads a JSONL file and returns parsed entries, skipping invalid lines
 */
function parseJsonlFile(filePath: string): JournalEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const entries: JournalEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const result = JournalEntrySchema.safeParse(parsed);
      if (result.success) {
        entries.push(result.data);
      } else {
        logger.warn(`Skipping unrecognized JSONL entry in ${path.basename(filePath)}`);
      }
    } catch {
      logger.warn(`Skipping invalid JSON line in ${path.basename(filePath)}`);
    }
  }
  return entries;
}

/**
 * Strips leading markdown heading syntax and whitespace from a string
 */
function stripMarkdownHeading(text: string): string {
  return text.replace(/^#+\s*/, '').trim();
}

/**
 * Extracts the session title, preferring Claude Code's AI-generated title
 * (from ai-title entries) over the first meaningful user message.
 */
function extractTitle(entries: JournalEntry[]): string | null {
  // Prefer the AI-generated title Claude Code writes to the JSONL
  for (const entry of entries) {
    if (entry.type === 'ai-title' && entry.aiTitle) return entry.aiTitle.slice(0, 120);
  }

  // Fall back to first meaningful user message
  for (const entry of entries) {
    if (entry.type !== 'user' || !entry.message) continue;
    const content = entry.message.content;
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed && !trimmed.startsWith('<')) return stripMarkdownHeading(trimmed).slice(0, 120);
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        const text = block.text?.trim();
        if (block.type === 'text' && text && !text.startsWith('<'))
          return stripMarkdownHeading(text).slice(0, 120);
      }
    }
  }
  return null;
}

/**
 * Attempts to decode a Claude Code project directory name back to an absolute path.
 * Claude Code encodes paths by replacing '/' with '-', which is ambiguous for paths
 * that contain dashes — the decoded path is only returned if it exists on disk.
 */
function tryDecodeProjectDir(dirName: string): string {
  const decoded = `/${dirName.replace(/^-/, '').replace(/-/g, '/')}`;
  try {
    if (fs.statSync(decoded).isDirectory()) return decoded;
  } catch {
    // Path doesn't exist — fall through
  }
  return dirName;
}

/**
 * Recursively finds all .jsonl files under a directory, skipping the memory dir
 */
function findJsonlFiles(dir: string): string[] {
  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of dirEntries) {
    if (entry.name === 'memory') continue; // skip Claude Code memory dir
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Returns the model identifier from the first assistant entry that declares one
 */
function extractModel(entries: JournalEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type === 'assistant' && entry.message?.model) return entry.message.model;
  }
  return null;
}

/**
 * Sums token counts across all assistant entries in the session
 */
function aggregateTokens(entries: JournalEntry[]): LocalSession['tokens'] {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const entry of entries) {
    if (entry.type === 'assistant' && entry.message?.usage) {
      const u = entry.message.usage;
      input += u.input_tokens;
      output += u.output_tokens;
      cacheRead += u.cache_read_input_tokens;
      cacheWrite += u.cache_creation_input_tokens;
    }
  }
  return { input, output, cacheRead, cacheWrite };
}

/**
 * Derives start time, end time, and duration from entry timestamps
 */
function extractTiming(entries: JournalEntry[]): {
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
} {
  const timestamps = entries
    .map((e) => e.timestamp)
    .filter((t): t is string => typeof t === 'string');

  const startTime = timestamps[0] ?? new Date().toISOString();
  const endTime = timestamps[timestamps.length - 1] ?? null;

  let durationSeconds: number | null = null;
  if (endTime) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durationSeconds = Math.round((end - start) / 1000);
    }
  }
  return { startTime, endTime, durationSeconds };
}

const RUNNING_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Determines session status. Returns 'running' if the last entry timestamp is
 * within 30 minutes — the session is likely still active. Otherwise uses the
 * last assistant stop_reason to distinguish success from failure.
 */
function extractStatus(entries: JournalEntry[]): LocalSession['status'] {
  const lastTimestamp = [...entries].reverse().find((e) => e.timestamp)?.timestamp;
  if (lastTimestamp && Date.now() - new Date(lastTimestamp).getTime() < RUNNING_THRESHOLD_MS) {
    return 'running';
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === 'assistant' && entry.message?.stop_reason) {
      return entry.message.stop_reason === 'max_tokens' ? 'failure' : 'success';
    }
  }
  return 'success';
}

/**
 * Constructs a LocalSession from a parsed JSONL entry list
 */
function buildSession(
  sessionId: string,
  projectDirName: string,
  entries: JournalEntry[],
): LocalSession {
  const cwd = entries.find((e) => e.cwd)?.cwd ?? tryDecodeProjectDir(projectDirName);
  const repoFullName = resolveRepoFullName(cwd);
  const { startTime, endTime, durationSeconds } = extractTiming(entries);

  return {
    sessionId,
    repoFullName,
    engine: 'claude',
    model: extractModel(entries),
    status: extractStatus(entries),
    title: extractTitle(entries),
    startTime,
    endTime,
    durationSeconds,
    tokens: aggregateTokens(entries),
  };
}

/**
 * Scanner for Claude Code sessions stored in ~/.claude/projects
 */
export class ClaudeScanner implements SessionScanner {
  readonly name = 'claude';

  /**
   * Returns true if the ~/.claude/projects directory exists
   */
  async isAvailable(): Promise<boolean> {
    try {
      return fs.statSync(getClaudeProjectsDir()).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Scans all Claude Code project directories and returns filtered sessions.
   * Sessions with no tokens or duration under 30s are dropped as noise.
   */
  async scan(): Promise<LocalSession[]> {
    const projectsDir = getClaudeProjectsDir();
    const sessions: LocalSession[] = [];

    let projectDirNames: string[];
    try {
      projectDirNames = fs.readdirSync(projectsDir);
    } catch {
      return sessions;
    }

    for (const projectDirName of projectDirNames) {
      const projectDirPath = path.join(projectsDir, projectDirName);
      try {
        if (!fs.statSync(projectDirPath).isDirectory()) continue;
      } catch {
        continue;
      }

      for (const jsonlFile of findJsonlFiles(projectDirPath)) {
        const sessionId = path.basename(jsonlFile, '.jsonl');
        const entries = parseJsonlFile(jsonlFile);
        if (entries.length === 0) continue;
        const session = buildSession(sessionId, projectDirName, entries);
        const tokens = session.tokens;
        const hasTokens = tokens.input > 0 || tokens.output > 0;
        const tooShort = session.durationSeconds !== null && session.durationSeconds < 30;
        if (!hasTokens || tooShort) continue;
        sessions.push(session);
      }
    }

    return sessions;
  }
}
