import { Command } from 'commander';
import pc from 'picocolors';
import { getEffectiveConfig } from '../services/config.js';
import { setForegroundMode } from '../services/logger.js';
import { ApiClient } from '../services/api.js';
import { runSync } from './sync.js';

const DEFAULT_INTERVAL_SECONDS = 300;

/**
 * Formats a seconds interval as a short human-readable string for display
 */
function formatNextSync(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

export const watchCommand = new Command('watch')
  .description('Run sync in a loop (background daemon mode)')
  .option('--interval <seconds>', 'sync interval in seconds', String(DEFAULT_INTERVAL_SECONDS))
  .option('--background', 'suppress stdout (for service mode)', false)
  .action(async (options: { interval: string; background: boolean }) => {
    const intervalSeconds = Math.max(
      10,
      Number.parseInt(options.interval, 10) || DEFAULT_INTERVAL_SECONDS,
    );

    if (options.background) {
      setForegroundMode(false);
    }

    let shuttingDown = false;

    const shutdown = () => {
      shuttingDown = true;
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Build API client once — reused across every interval for ping calls
    const config = getEffectiveConfig();
    const api = config ? new ApiClient(config) : null;

    if (!options.background) {
      console.log(
        pc.dim(
          `AgentMeter watching — syncing every ${formatNextSync(intervalSeconds)}. Press Ctrl+C to stop.\n`,
        ),
      );
    }

    while (!shuttingDown) {
      const now = new Date().toLocaleTimeString('en-US', { hour12: false });

      // Fire heartbeat ping before sync so the dashboard shows "Connected"
      // immediately when the watch loop wakes up. Fire-and-forget — a failed
      // ping never blocks the sync.
      if (api) {
        api.sendPing().catch(() => {
          // swallow — sendPing already logs internally
        });
      }

      try {
        const result = await runSync({ verbose: false });

        if (!options.background) {
          const synced = result.newCount + result.updatedCount;
          const parts: string[] = [];
          if (result.newCount > 0) parts.push(`${result.newCount} new`);
          if (result.updatedCount > 0) parts.push(`${result.updatedCount} updated`);
          const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';

          const cost =
            result.totalCostCents > 0 ? ` · $${(result.totalCostCents / 100).toFixed(2)}` : '';

          console.log(
            `[${now}] Synced ${synced} session${synced === 1 ? '' : 's'}${detail}${cost} · next sync in ${formatNextSync(intervalSeconds)}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!options.background) {
          console.error(pc.red(`[${now}] Sync error: ${message}`));
        }
      }

      // Wait the interval, but check for shutdown every second
      let waited = 0;
      while (!shuttingDown && waited < intervalSeconds) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        waited++;
      }
    }

    if (!options.background) {
      console.log(pc.dim('\nShutting down... sync state saved. Goodbye.'));
    }
  });
