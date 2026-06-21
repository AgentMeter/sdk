import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
// Type-only import: erased at compile time so Vite/esbuild never statically
// resolves node:sqlite. The actual class is loaded at runtime via createRequire
// (a CJS-style require that bypasses esbuild's static import analysis).
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { LocalSession } from '../schemas/session.js';
import { logger } from '../services/logger.js';
import { resolveRepoFullName } from '../utils/repo.js';
import type { SessionScanner } from './types.js';

// createRequire lets us load node:sqlite at runtime without esbuild stripping
// the node: prefix (which it does for ESM dynamic imports of experimental modules).
const _require = createRequire(import.meta.url);

// ─── Zod schemas ───────────────────────────────────────────────────────────

const WorkspaceUriSchema = z
  .object({
    /** Absolute filesystem path to the workspace folder */
    fsPath: z.string().optional(),
    /** Workspace folder path (may differ from fsPath on non-macOS) */
    path: z.string().optional(),
    /** Full file URI, e.g. "file:///Users/adam/Projects/my-app" */
    external: z.string().optional(),
  })
  .passthrough();

const WorkspaceIdentifierSchema = z
  .object({
    uri: WorkspaceUriSchema.optional(),
  })
  .passthrough();

const ComposerHeaderSchema = z
  .object({
    /** UUID that links to agentKv:bubbleCheckpoint:{composerId}:* keys */
    composerId: z.string(),
    /** Unix milliseconds */
    createdAt: z.number().optional(),
    /** Unix milliseconds */
    lastUpdatedAt: z.number().optional(),
    /** AI-generated session title */
    name: z.string().optional(),
    /** Session interaction mode */
    unifiedMode: z.enum(['chat', 'agent', 'plan']).catch('chat').optional(),
    /** Whether the session was archived by the user */
    isArchived: z.boolean().optional(),
    workspaceIdentifier: WorkspaceIdentifierSchema.optional(),
  })
  .passthrough();

const ComposerHeadersSchema = z
  .object({
    allComposers: z.array(ComposerHeaderSchema).optional(),
  })
  .passthrough();

/** Decoded data extracted from a single bubble checkpoint protobuf blob */
interface BubbleData {
  modelName: string | null;
  contextTokens: number | null;
}

// ─── Minimal protobuf decoder ──────────────────────────────────────────────

/**
 * Reads a protobuf varint from buf starting at pos.
 * Returns [value, nextPos]. Safe for values up to 2^53.
 *
 * Positional params are kept here (rather than an object) since this runs in the
 * hot loop of decodeBubbleCheckpoint, called once per protobuf field per session.
 */
function readVarint(buf: Buffer, pos: number): [value: number, nextPos: number] {
  let result = 0;
  let multiplier = 1;
  let offset = pos;
  while (offset < buf.length) {
    const byte = buf[offset];
    if (byte === undefined) break;
    offset++;
    result += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    if ((byte & 0x80) === 0) break;
  }
  return [result, offset];
}

/**
 * Extracts the modelName from a Cursor assistant message JSON blob (field 4).
 * The JSON has shape: { role, content: [{ providerOptions: { cursor: { modelName } } }] }
 */
function extractModelFromJson(jsonStr: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const content = p.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const opts = (item as Record<string, unknown>).providerOptions;
    if (!opts || typeof opts !== 'object') continue;
    const cursor = (opts as Record<string, unknown>).cursor;
    if (!cursor || typeof cursor !== 'object') continue;
    const mn = (cursor as Record<string, unknown>).modelName;
    if (typeof mn === 'string' && mn.length > 0) return mn;
  }
  return null;
}

/**
 * Decodes a bubble checkpoint protobuf hex blob to extract the model name
 * (from field 4 JSON) and cumulative context token count (from field 5, sub-field 1).
 * Gracefully returns nulls for any field that can't be extracted.
 */
function decodeBubbleCheckpoint(hex: string): BubbleData {
  let buf: Buffer;
  try {
    buf = Buffer.from(hex, 'hex');
  } catch {
    return { modelName: null, contextTokens: null };
  }

  let modelName: string | null = null;
  let contextTokens: number | null = null;
  let offset = 0;

  while (offset < buf.length) {
    let tag: number;
    [tag, offset] = readVarint(buf, offset);
    if (offset >= buf.length && tag === 0) break;

    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;

    if (wireType === 0) {
      [, offset] = readVarint(buf, offset);
    } else if (wireType === 2) {
      const [len, dataStart] = readVarint(buf, offset);
      const dataEnd = dataStart + len;

      if (fieldNumber === 4 && modelName === null) {
        const jsonStr = buf.toString('utf8', dataStart, dataEnd);
        modelName = extractModelFromJson(jsonStr);
      } else if (fieldNumber === 5 && contextTokens === null) {
        const nested = buf.subarray(dataStart, dataEnd);
        let nOffset = 0;
        while (nOffset < nested.length) {
          let nTag: number;
          [nTag, nOffset] = readVarint(nested, nOffset);
          const nField = nTag >>> 3;
          const nWire = nTag & 0x7;
          if (nWire === 0) {
            let val: number;
            [val, nOffset] = readVarint(nested, nOffset);
            if (nField === 1) {
              contextTokens = val;
              break;
            }
          } else {
            break;
          }
        }
      }

      offset = dataEnd;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }

  return { modelName, contextTokens };
}

// ─── Model name normalization ──────────────────────────────────────────────

/**
 * Normalizes a Cursor model name to the AgentMeter pricing matrix key format.
 *
 * Cursor uses `claude-{version}-{family}[-{variant}]` (e.g. "claude-4.5-sonnet-thinking"),
 * while the AgentMeter matrix uses `claude-{family}-{version}` (e.g. "claude-sonnet-4-5").
 * GPT models may have trailing quality qualifiers (-high/-medium/-low) that are stripped.
 */
function normalizeCursorModel(raw: string): string {
  const claudeMatch = raw.match(/^claude-(\d+\.\d+)-(sonnet|haiku|opus)/i);
  if (claudeMatch) {
    const version = claudeMatch[1]?.replace('.', '-') ?? '';
    const family = claudeMatch[2]?.toLowerCase() ?? '';
    return `claude-${family}-${version}`;
  }
  if (raw.startsWith('gpt-')) {
    return raw.replace(/-(high|medium|low)$/, '');
  }
  return raw;
}

// ─── Platform paths ────────────────────────────────────────────────────────

/**
 * Returns the platform-specific path to Cursor's application data directory.
 * macOS: ~/Library/Application Support/Cursor
 * Linux: ~/.config/Cursor
 * Windows: ~/AppData/Roaming/Cursor
 */
function getCursorDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor');
  }
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config', 'Cursor');
  }
  return path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor');
}

/**
 * Returns the path to Cursor's global state DB.
 * This DB holds both session headers (composer.composerHeaders in ItemTable)
 * and all bubble checkpoint blobs (agentKv:* in cursorDiskKV).
 */
function getGlobalDbPath(): string {
  return path.join(getCursorDataDir(), 'User', 'globalStorage', 'state.vscdb');
}

// ─── Database helpers ──────────────────────────────────────────────────────

/**
 * Opens a SQLite DB at the given path. Returns null if the file doesn't exist
 * or cannot be opened (e.g. locked by Cursor).
 */
function openDb({
  DbClass,
  dbPath,
}: {
  /** SQLite database class constructor, loaded at runtime via createRequire */
  DbClass: typeof DatabaseSync;

  /** Filesystem path to the SQLite database file */
  dbPath: string;
}): DatabaseSync | null {
  try {
    return new DbClass(dbPath);
  } catch {
    return null;
  }
}

/**
 * Reads a single text value from ItemTable by key. Returns null if missing or on error.
 */
function readItemTableValue({
  db,
  key,
}: {
  /** Open SQLite database connection */
  db: DatabaseSync;

  /** ItemTable key to read */
  key: string;
}): string | null {
  try {
    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
    const row = stmt.get(key) as Record<string, unknown> | undefined;
    const val = row?.value;
    return typeof val === 'string' ? val : null;
  } catch {
    return null;
  }
}

/**
 * Reads ALL bubble checkpoint hashes from cursorDiskKV in a single query,
 * returning a Map from composerId to the list of SHA256 hash strings for that session.
 *
 * Key format: agentKv:bubbleCheckpoint:{composerId}:{bubbleId} → SHA256 hash
 * Per-session LIKE queries are avoided because cursorDiskKV has ~148K rows and the
 * index is not used efficiently for LIKE, making per-session scans ~1s each (230s total).
 * One batch query returning all ~305 rows takes ~2s regardless of session count.
 */
function readAllBubbleHashesBySession(db: DatabaseSync): Map<string, string[]> {
  const result = new Map<string, string[]>();
  try {
    const rows = db
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'agentKv:bubbleCheckpoint:%'")
      .all() as Record<string, unknown>[];
    for (const row of rows) {
      const key = row.key;
      const val = row.value;
      if (typeof key !== 'string' || typeof val !== 'string' || val.length === 0) continue;
      // key format: agentKv:bubbleCheckpoint:{composerId}:{bubbleId}
      const parts = key.split(':');
      const composerId = parts[2];
      if (!composerId) continue;
      const existing = result.get(composerId);
      if (existing) {
        existing.push(val);
      } else {
        result.set(composerId, [val]);
      }
    }
  } catch {
    // Return empty map — caller will skip sessions with no hashes
  }
  return result;
}

/**
 * Reads token totals for a single session from the older `bubbleId:{composerId}:{bubbleId}`
 * storage format. Uses a BETWEEN range scan (O(log n)) rather than LIKE (O(n table scan)).
 * Returns null when the session has no token data in this format.
 */
function readBubbleIdTokens({
  composerId,
  stmt,
}: {
  /** Composer (session) ID to look up token totals for */
  composerId: string;

  /** Prepared BETWEEN range-scan statement over cursorDiskKV */
  stmt: ReturnType<DatabaseSync['prepare']>;
}): { input: number; output: number } | null {
  try {
    const lo = `bubbleId:${composerId}:`;
    const hi = `bubbleId:${composerId}:￿`;
    const row = stmt.get(lo, hi) as Record<string, unknown> | undefined;
    const input = typeof row?.totalInput === 'number' ? row.totalInput : 0;
    const output = typeof row?.totalOutput === 'number' ? row.totalOutput : 0;
    return input > 0 || output > 0 ? { input, output } : null;
  } catch {
    return null;
  }
}

/**
 * Fetches the hex-encoded protobuf blobs for all content hashes in a single batch query.
 * Returns a Map from hash to blob hex string.
 */
function readAllBlobs({
  db,
  hashes,
}: {
  /** Open SQLite database connection */
  db: DatabaseSync;

  /** Content hashes (SHA256) to fetch blobs for */
  hashes: string[];
}): Map<string, string> {
  const result = new Map<string, string>();
  if (hashes.length === 0) return result;
  try {
    const placeholders = hashes.map(() => '?').join(', ');
    const keys = hashes.map((h) => `agentKv:blob:${h}`);
    const rows = db
      .prepare(`SELECT key, value FROM cursorDiskKV WHERE key IN (${placeholders})`)
      .all(...keys) as Record<string, unknown>[];
    for (const row of rows) {
      const key = row.key;
      const val = row.value;
      if (typeof key !== 'string' || typeof val !== 'string' || val.length === 0) continue;
      const hash = key.slice('agentKv:blob:'.length);
      result.set(hash, val);
    }
  } catch {
    // Return partial result — caller will skip sessions with no blobs
  }
  return result;
}

/**
 * Reads the context-window token count from `composerData:{composerId}` in cursorDiskKV.
 * This is the final context-window size at the end of the session — used as a fallback
 * when neither the agentKv protobuf nor the older bubbleId JSON format has data.
 * Returns null if the entry is missing or contextTokensUsed is zero.
 */
function readComposerDataTokens({
  composerId,
  db,
}: {
  /** Composer (session) ID to look up the final context-window size for */
  composerId: string;

  /** Open SQLite database connection */
  db: DatabaseSync;
}): number | null {
  try {
    const row = db
      .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
      .get(`composerData:${composerId}`) as Record<string, unknown> | undefined;
    if (!row) return null;
    const val = row.value;
    if (typeof val !== 'string') return null;
    const parsed: unknown = JSON.parse(val);
    if (!parsed || typeof parsed !== 'object') return null;
    const tokens = (parsed as Record<string, unknown>).contextTokensUsed;
    return typeof tokens === 'number' && tokens > 0 ? tokens : null;
  } catch {
    return null;
  }
}

// ─── Session building ──────────────────────────────────────────────────────

const RUNNING_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Aggregates token counts and picks the first non-null model name
 * from all decoded bubble checkpoint blobs for a session.
 */
function aggregateBubbles(blobs: string[]): { totalTokens: number; model: string | null } {
  let totalTokens = 0;
  let model: string | null = null;
  for (const hex of blobs) {
    const { modelName, contextTokens } = decodeBubbleCheckpoint(hex);
    if (contextTokens !== null) totalTokens += contextTokens;
    if (modelName !== null && model === null) model = modelName;
  }
  return { totalTokens, model };
}

/**
 * Converts a file:// URI to an absolute local path, or returns the input unchanged.
 */
function fileUriToPath(uri: string): string {
  if (uri.startsWith('file://')) return uri.slice('file://'.length);
  return uri;
}

/**
 * Extracts the best available workspace path from a WorkspaceIdentifier URI.
 */
function resolveWorkspacePath(wsId: z.infer<typeof WorkspaceIdentifierSchema> | undefined): string {
  if (!wsId?.uri) return '';
  const uri = wsId.uri;
  if (uri.fsPath) return uri.fsPath;
  if (uri.path) return uri.path;
  if (uri.external) return fileUriToPath(uri.external);
  return '';
}

/**
 * Builds a LocalSession from a Cursor composer header and its aggregated bubble data.
 */
function buildCursorSession({
  composerId,
  createdAt,
  lastUpdatedAt,
  rawModel,
  title,
  totalTokens,
  workspacePath,
}: {
  /** Cursor's composer ID, used as the session ID */
  composerId: string;

  /** Unix milliseconds the session was created */
  createdAt: number;

  /** Unix milliseconds the session was last updated */
  lastUpdatedAt: number;

  /** Raw Cursor model name, normalized before use */
  rawModel: string | null;

  /** AI-generated session title */
  title: string | null;

  /** Aggregated token count across all bubble checkpoints */
  totalTokens: number;

  /** Resolved workspace folder path, or empty string if unknown */
  workspacePath: string;
}): LocalSession {
  const startTime = new Date(createdAt).toISOString();
  const endTime = new Date(lastUpdatedAt).toISOString();
  const durationSeconds = Math.max(0, Math.round((lastUpdatedAt - createdAt) / 1000));
  const isRunning = Date.now() - lastUpdatedAt < RUNNING_THRESHOLD_MS;

  return {
    sessionId: composerId,
    repoFullName: workspacePath ? resolveRepoFullName(workspacePath) : 'unknown',
    engine: 'cursor',
    model: rawModel !== null ? normalizeCursorModel(rawModel) : null,
    status: isRunning ? 'running' : 'success',
    title,
    startTime,
    endTime,
    durationSeconds,
    tokens: {
      input: totalTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      isApproximate: true,
    },
  };
}

// ─── Scanner ───────────────────────────────────────────────────────────────

/**
 * Scanner for Cursor AI coding agent sessions (agent mode only).
 *
 * Reads session metadata from `composer.composerHeaders` in the global state DB
 * and token/model data from protobuf bubble checkpoint blobs in cursorDiskKV.
 * Only sessions that have per-turn bubble checkpoints (agent-mode sessions with
 * local token data) are reported; chat-only sessions have no local token records.
 */
export class CursorScanner implements SessionScanner {
  readonly name = 'cursor';

  /**
   * Returns true if the Cursor application data directory exists on this machine
   */
  async isAvailable(): Promise<boolean> {
    try {
      return fs.statSync(getCursorDataDir()).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Scans Cursor agent sessions and returns them as normalized LocalSession objects.
   * Token counts are summed from per-turn protobuf bubble checkpoints (approximate).
   * Sessions with no bubble checkpoint data are skipped.
   */
  async scan(): Promise<LocalSession[]> {
    // Load node:sqlite at runtime via createRequire. This avoids the esbuild
    // issue where dynamic import('node:sqlite') has the node: prefix stripped.
    let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
    try {
      const sqlite = _require('node:sqlite') as typeof import('node:sqlite');
      DatabaseSync = sqlite.DatabaseSync;
    } catch {
      logger.warn('node:sqlite not available — Cursor scanning disabled');
      return [];
    }

    const globalDb = openDb({ DbClass: DatabaseSync, dbPath: getGlobalDbPath() });
    if (!globalDb) {
      logger.warn('Cursor global DB unavailable — skipping Cursor scan');
      return [];
    }

    try {
      return this._scanWithDb(globalDb);
    } finally {
      globalDb.close();
    }
  }

  /**
   * Internal scan implementation that operates on an open global DB connection.
   *
   * Cursor uses two different storage schemes depending on its version:
   * - Newer: agentKv:bubbleCheckpoint:{composerId}:{bubbleId} → SHA256 → protobuf blob
   * - Older: bubbleId:{composerId}:{bubbleId} → JSON with tokenCount field
   *
   * We batch the newer format into 2 queries, then fall back to per-session BETWEEN
   * range scans for the older format (BETWEEN uses the B-tree index; LIKE does not).
   */
  private _scanWithDb(globalDb: DatabaseSync): LocalSession[] {
    const headersRaw = readItemTableValue({ db: globalDb, key: 'composer.composerHeaders' });
    if (!headersRaw) return [];

    let parsedHeaders: z.infer<typeof ComposerHeadersSchema>;
    try {
      const result = ComposerHeadersSchema.safeParse(JSON.parse(headersRaw));
      if (!result.success) return [];
      parsedHeaders = result.data;
    } catch {
      return [];
    }

    // Newer format: batch load all agentKv bubble checkpoints and blobs.
    const hashesBySession = readAllBubbleHashesBySession(globalDb);
    const allHashes = [...hashesBySession.values()].flat();
    const blobByHash = readAllBlobs({ db: globalDb, hashes: allHashes });

    // Older format: prepared statement for per-session BETWEEN range scan.
    const bubbleIdStmt = globalDb.prepare(`
      SELECT
        SUM(COALESCE(json_extract(value, '$.tokenCount.inputTokens'), 0)) AS totalInput,
        SUM(COALESCE(json_extract(value, '$.tokenCount.outputTokens'), 0)) AS totalOutput
      FROM cursorDiskKV
      WHERE key BETWEEN ? AND ? AND typeof(value) = 'text'
    `);

    const sessions: LocalSession[] = [];

    for (const composer of parsedHeaders.allComposers ?? []) {
      if (!composer.composerId || !composer.createdAt) continue;

      // Only agent-mode sessions have per-turn bubble checkpoint data
      if (composer.unifiedMode !== 'agent') continue;
      if (composer.isArchived) continue;

      let totalTokens = 0;
      let model: string | null = null;

      const hashes = hashesBySession.get(composer.composerId);
      if (hashes && hashes.length > 0) {
        // Newer agentKv format: decode protobuf blobs
        const blobs = hashes
          .map((h) => blobByHash.get(h))
          .filter((b): b is string => b !== undefined);
        const agg = aggregateBubbles(blobs);
        totalTokens = agg.totalTokens;
        model = agg.model;
      } else {
        // Older bubbleId JSON format: sum tokenCount fields via BETWEEN range scan
        const bubbleTokens = readBubbleIdTokens({
          composerId: composer.composerId,
          stmt: bubbleIdStmt,
        });
        if (bubbleTokens) {
          totalTokens = bubbleTokens.input + bubbleTokens.output;
        } else {
          // Newest format: contextTokensUsed in composerData (final context-window size)
          totalTokens =
            readComposerDataTokens({ composerId: composer.composerId, db: globalDb }) ?? 0;
        }
      }

      if (totalTokens === 0) continue;

      sessions.push(
        buildCursorSession({
          composerId: composer.composerId,
          createdAt: composer.createdAt,
          lastUpdatedAt: composer.lastUpdatedAt ?? composer.createdAt,
          rawModel: model,
          title: composer.name ?? null,
          totalTokens,
          workspacePath: resolveWorkspacePath(composer.workspaceIdentifier),
        }),
      );
    }

    return sessions;
  }
}
