import { Command } from 'commander';
import pc from 'picocolors';
import { ClaudeScanner } from '../scanners/claude.js';
import { CursorScanner } from '../scanners/cursor.js';
import type { LocalSession } from '../schemas/session.js';
import type { SyncState } from '../schemas/sync-state.js';
import type { SubmitResult } from '../services/api.js';
import { ApiClient } from '../services/api.js';
import { getEffectiveConfig } from '../services/config.js';
import { logger } from '../services/logger.js';
import { readSyncState, writeSyncState } from '../services/sync-state.js';
import { formatCost, formatDuration } from '../utils/format.js';

/**
 * Runtime options for a sync run, controlling output and filtering
 */
export interface SyncOptions {
  /** Whether to print a row for every session processed */
  verbose: boolean;

  /** When true, reports what would be submitted without sending any data */
  dryRun: boolean;

  /** ISO 8601 date string; only sessions starting on or after this date are included */
  since?: string;

  /** Scanner name filter (e.g. "claude"); omit to include all available scanners */
  engine?: string;
}

/**
 * Aggregated counts and cost totals returned from a completed sync run
 */
export interface SyncResult {
  /** Number of sessions submitted for the first time */
  newCount: number;

  /** Number of sessions re-submitted because their status or endTime changed */
  updatedCount: number;

  /** Number of sessions that were already up-to-date and skipped */
  skippedCount: number;

  /** Number of sessions that failed to submit */
  errorCount: number;

  /** Sum of costCents across all successfully submitted sessions */
  totalCostCents: number;
}

/**
 * Sessions split into those needing submission and those already up-to-date
 */
interface SessionClassification {
  /** Sessions to submit, tagged with whether they are new or just updated */
  toSync: Array<{ session: LocalSession; isNew: boolean }>;

  /** Sessions that match their already-synced state and can be skipped */
  skipped: LocalSession[];
}

/**
 * Scans all available engines for sessions, optionally filtered by date
 */
async function gatherSessions(opts: SyncOptions): Promise<LocalSession[]> {
  const allScanners = [new ClaudeScanner(), new CursorScanner()];
  const allSessions: LocalSession[] = [];

  for (const scanner of allScanners) {
    if (opts.engine && scanner.name !== opts.engine) continue;
    if (!(await scanner.isAvailable())) continue;
    const sessions = await scanner.scan();
    allSessions.push(...sessions);
  }

  if (!opts.since) return allSessions;

  const sinceDate = new Date(opts.since);
  if (Number.isNaN(sinceDate.getTime())) {
    console.error(pc.red(`Invalid date: ${opts.since}`));
    process.exit(1);
  }
  return allSessions.filter((s) => new Date(s.startTime) >= sinceDate);
}

/**
 * Splits sessions into those needing submission and those already up-to-date
 */
function classifySessions(sessions: LocalSession[], syncState: SyncState): SessionClassification {
  const toSync: Array<{ session: LocalSession; isNew: boolean }> = [];
  const skipped: LocalSession[] = [];

  for (const session of sessions) {
    const existing = syncState.sessions[session.sessionId];
    if (!existing) {
      toSync.push({ session, isNew: true });
    } else if (
      existing.status !== session.status ||
      existing.endTime !== (session.endTime ?? null) ||
      (existing.title ?? null) !== (session.title ?? null)
    ) {
      toSync.push({ session, isNew: false });
    } else {
      skipped.push(session);
    }
  }

  return { toSync, skipped };
}

/**
 * Finds sessions in sync state that were last seen as RUNNING but are absent from the current
 * scan results, and returns them as best-effort completion records (status: success, endTime: now).
 *
 * Only called during full scans (no --engine or --since filter) to avoid false positives from
 * partial scan results.
 */
function resolveVanishedSessions(
  scannedIds: Set<string>,
  syncState: SyncState,
): Array<{ session: LocalSession; isNew: boolean }> {
  const now = new Date().toISOString();
  const vanished: Array<{ session: LocalSession; isNew: boolean }> = [];

  for (const [sessionId, stored] of Object.entries(syncState.sessions)) {
    if (stored.status !== 'running') continue;
    if (scannedIds.has(sessionId)) continue;
    if (!stored.repoFullName || !stored.engine) continue;

    vanished.push({
      isNew: false,
      session: {
        sessionId,
        repoFullName: stored.repoFullName,
        engine: stored.engine,
        model: stored.model ?? null,
        status: 'success',
        title: stored.title ?? null,
        startTime: stored.startTime ?? now,
        endTime: now,
        durationSeconds: null,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    });
  }

  return vanished;
}

/**
 * Prints a dry-run summary listing what would be submitted without sending anything
 */
function printDryRun(toSync: Array<{ session: LocalSession; isNew: boolean }>): void {
  for (const { session, isNew } of toSync) {
    const action = isNew ? 'Would submit' : 'Would update';
    const label = isNew ? 'new' : `updated: ${session.status}`;
    console.log(
      pc.dim(
        `[dry-run] ${action}: ${session.sessionId} "${session.title ?? '(no title)'}" (${session.model ?? 'unknown'}, ${formatDuration(session.durationSeconds)}) [${label}]`,
      ),
    );
  }
  console.log(pc.dim(`[dry-run] ${toSync.length} sessions would be synced. No data was sent.`));
}

/**
 * Prints a single verbose row for a submitted session
 */
function printVerboseRow(session: LocalSession, result: SubmitResult, isNew: boolean): void {
  const label = isNew ? pc.green('[new]') : pc.yellow('[updated]');
  const cost = result.costCents ? formatCost(result.costCents) : '—';
  console.log(
    `  ${pc.green('✓')} ${session.sessionId}  ${session.title ?? '(no title)'}  ${session.model ?? 'unknown'}  ${cost}  ${formatDuration(session.durationSeconds)}  ${label}`,
  );
}

/**
 * Submits all pending sessions to the API and updates sync state in place
 */
async function submitAll(
  toSync: Array<{ session: LocalSession; isNew: boolean }>,
  api: ApiClient,
  syncState: SyncState,
  verbose: boolean,
): Promise<{ newCount: number; updatedCount: number; errorCount: number; totalCostCents: number }> {
  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  let totalCostCents = 0;

  for (const { session, isNew } of toSync) {
    const result = await api.submitSession(session).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`\nError: ${message}`));
      writeSyncState({ ...syncState, lastSyncAt: new Date().toISOString() });
      process.exit(1);
    });

    if (result.status === 'error') {
      errorCount++;
      if (verbose) {
        console.log(
          pc.red(`  ✗ ${session.sessionId}  ${session.title ?? '(no title)'}  ${result.error}`),
        );
      }
      continue;
    }

    syncState.sessions[session.sessionId] = {
      status: session.status,
      submittedAt: new Date().toISOString(),
      costCents: result.costCents ?? null,
      endTime: session.endTime ?? null,
      title: session.title ?? null,
      engine: session.engine,
      repoFullName: session.repoFullName,
      model: session.model,
      startTime: session.startTime,
    };

    if (result.costCents) totalCostCents += result.costCents;
    if (isNew) {
      newCount++;
    } else {
      updatedCount++;
    }

    if (verbose) printVerboseRow(session, result, isNew);
  }

  return { newCount, updatedCount, errorCount, totalCostCents };
}

/**
 * Prints the final sync summary line with counts and total cost
 */
function printSummary(
  newCount: number,
  updatedCount: number,
  skipped: LocalSession[],
  totalCostCents: number,
  verbose: boolean,
): void {
  if (verbose) {
    for (const session of skipped) {
      console.log(
        pc.dim(
          `  · ${session.sessionId}  ${session.title ?? '(no title)'}  ${session.model ?? 'unknown'}  —  —  [unchanged]`,
        ),
      );
    }
  }

  const parts: string[] = [];
  if (newCount > 0) parts.push(`${newCount} new`);
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const total = newCount + updatedCount;

  console.log(pc.green(`✓ Synced ${total} session${total === 1 ? '' : 's'}${detail}`));
  if (totalCostCents > 0) console.log(`  Total cost: ${formatCost(totalCostCents)}`);
  if (skipped.length > 0) console.log(`  Skipped: ${skipped.length} (already synced)`);
}

/**
 * Runs a full scan-and-submit sync cycle, respecting dry-run and filter options
 */
export async function runSync(options: Partial<SyncOptions> = {}): Promise<SyncResult> {
  const opts: SyncOptions = { verbose: false, dryRun: false, ...options };

  const config = getEffectiveConfig();
  if (!config) {
    console.error(pc.red('Error: No API key configured. Run `agentmeter init` first.'));
    process.exit(1);
  }

  const sessions = await gatherSessions(opts);
  const syncState = readSyncState();
  const { toSync, skipped } = classifySessions(sessions, syncState);

  // On full scans (no engine/since filter), close out any RUNNING sessions that have
  // vanished from disk — e.g. project deleted or Cursor window closed.
  if (!opts.engine && !opts.since) {
    const scannedIds = new Set(sessions.map((s) => s.sessionId));
    toSync.push(...resolveVanishedSessions(scannedIds, syncState));
  }

  if (sessions.length === 0 && toSync.length === 0) {
    console.log(pc.yellow('No supported AI coding agents found on this machine.'));
    return { newCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 0, totalCostCents: 0 };
  }

  if (opts.dryRun) {
    printDryRun(toSync);
    return {
      newCount: toSync.filter((s) => s.isNew).length,
      updatedCount: toSync.filter((s) => !s.isNew).length,
      skippedCount: skipped.length,
      errorCount: 0,
      totalCostCents: 0,
    };
  }

  if (toSync.length === 0) {
    console.log(
      pc.green('✓ All sessions up to date') + pc.dim(` (${skipped.length} already synced)`),
    );
    return {
      newCount: 0,
      updatedCount: 0,
      skippedCount: skipped.length,
      errorCount: 0,
      totalCostCents: 0,
    };
  }

  const api = new ApiClient(config);
  const { newCount, updatedCount, errorCount, totalCostCents } = await submitAll(
    toSync,
    api,
    syncState,
    opts.verbose,
  );

  syncState.lastSyncAt = new Date().toISOString();
  writeSyncState(syncState);

  printSummary(newCount, updatedCount, skipped, totalCostCents, opts.verbose);
  logger.info(
    `Sync complete: ${newCount} new, ${updatedCount} updated, ${skipped.length} skipped, ${errorCount} errors`,
  );

  return { newCount, updatedCount, skippedCount: skipped.length, errorCount, totalCostCents };
}

export const syncCommand = new Command('sync')
  .description('One-time scan and upload of local sessions')
  .option('--verbose', "show each session's status", false)
  .option('--dry-run', 'show what would be submitted without sending', false)
  .option('--since <date>', 'only sessions after this date (ISO 8601)')
  .option('--engine <name>', 'filter to a specific scanner (e.g. claude)')
  .action(
    async (options: { verbose: boolean; dryRun: boolean; since?: string; engine?: string }) => {
      try {
        await runSync(options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(pc.red(`Error: ${message}`));
        process.exit(1);
      }
    },
  );
