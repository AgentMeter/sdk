import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { LocalSession } from '../schemas/session.js';
import { logger } from '../services/logger.js';
import { getClaudeProjectsDir } from '../utils/platform.js';
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
    message: MessageSchema.optional(),
  })
  .passthrough();

type JournalEntry = z.infer<typeof JournalEntrySchema>;

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

function extractTitle(entries: JournalEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type !== 'user' || !entry.message) continue;
    const content = entry.message.content;
    if (typeof content === 'string' && content.trim()) return content.slice(0, 120);
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) return block.text.slice(0, 120);
      }
    }
  }
  return null;
}

function tryDecodeProjectPath(dirName: string): string {
  // Claude Code encodes the absolute project path by replacing '/' with '-'.
  // Example: '/Users/adam/Projects/myapp' → '-Users-adam-Projects-myapp'
  // This decode is a best-effort heuristic — unreliable for paths with dashes.
  const decoded = `/${dirName.replace(/^-/, '').replace(/-/g, '/')}`;
  try {
    if (fs.statSync(decoded).isDirectory()) return decoded;
  } catch {
    // Path doesn't exist — fall through
  }
  return dirName;
}

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

function extractModel(entries: JournalEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type === 'assistant' && entry.message?.model) return entry.message.model;
  }
  return null;
}

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

function extractStatus(entries: JournalEntry[]): LocalSession['status'] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === 'assistant' && entry.message?.stop_reason) {
      return entry.message.stop_reason === 'max_tokens' ? 'failure' : 'success';
    }
  }
  return 'success';
}

function buildSession(
  sessionId: string,
  projectDirName: string,
  entries: JournalEntry[],
): LocalSession {
  const firstEntry = entries[0];
  const projectPath = firstEntry?.cwd ?? tryDecodeProjectPath(projectDirName);
  const { startTime, endTime, durationSeconds } = extractTiming(entries);

  return {
    sessionId,
    projectPath,
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

export class ClaudeScanner implements SessionScanner {
  readonly name = 'claude';

  async isAvailable(): Promise<boolean> {
    try {
      return fs.statSync(getClaudeProjectsDir()).isDirectory();
    } catch {
      return false;
    }
  }

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
        sessions.push(buildSession(sessionId, projectDirName, entries));
      }
    }

    return sessions;
  }
}
