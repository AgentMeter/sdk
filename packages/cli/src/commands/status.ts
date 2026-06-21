import os from 'node:os';
import { Command } from 'commander';
import pc from 'picocolors';
import { ClaudeScanner } from '../scanners/claude.js';
import { CursorScanner } from '../scanners/cursor.js';
import { ApiClient } from '../services/api.js';
import { getEffectiveConfig } from '../services/config.js';
import { isServiceInstalled, isServiceRunning } from '../services/service-installer.js';
import { readSyncState } from '../services/sync-state.js';
import { formatRelativeTime } from '../utils/format.js';
import { getConfigPath, getLogPath } from '../utils/platform.js';

/**
 * Prints a padded label/value row for the status display
 */
function row({
  label,
  value,
}: {
  /** Field name shown on the left, e.g. "Service" */
  label: string;

  /** Field value shown on the right, may include color codes */
  value: string;
}): void {
  const pad = 12;
  const paddedLabel = `${label}:`.padEnd(pad);
  console.log(`  ${pc.dim(paddedLabel)} ${value}`);
}

export const statusCommand = new Command('status')
  .description('Show service and sync health')
  .action(async () => {
    const config = getEffectiveConfig();

    console.log(`\n${pc.bold('AgentMeter CLI Status')}`);
    console.log(pc.dim('─────────────────────'));

    // Service status
    const installed = isServiceInstalled();
    const running = installed && isServiceRunning();

    const syncState = readSyncState();
    const sessionCount = Object.keys(syncState.sessions).length;
    const pendingCount = Object.values(syncState.sessions).filter(
      (s) => s?.status !== 'success',
    ).length;

    let serviceLabel: string;
    if (running) {
      const lastSync = syncState.lastSyncAt ? formatRelativeTime(syncState.lastSyncAt) : 'never';
      serviceLabel = pc.green('✓ Running') + pc.dim(` (last sync: ${lastSync})`);
    } else if (installed) {
      serviceLabel = pc.yellow('⚠ Installed but not running');
    } else {
      serviceLabel = pc.red('✗ Not installed') + pc.dim(' (run `npx @agentmeter/cli install`)');
    }
    row({ label: 'Service', value: serviceLabel });

    if (!config) {
      row({ label: 'API key', value: pc.red('✗ Not configured (run `agentmeter init`)') });
      console.log();
      process.exit(0);
    }

    // Validate API key
    let keyLabel: string;
    let orgName: string | null = null;
    let userName: string | null = null;
    try {
      const client = new ApiClient(config);
      const validation = await client.validateKey();
      if (validation.valid) {
        const keyType = validation.keyType ? ` (${validation.keyType} key)` : '';
        keyLabel = pc.green('✓ Valid') + pc.dim(keyType);
        orgName = validation.orgName;
        userName = validation.userName;
      } else {
        keyLabel = pc.red('✗ Invalid');
      }
    } catch {
      keyLabel = pc.yellow('— Could not validate (offline?)');
    }

    row({ label: 'API key', value: keyLabel });
    if (orgName) row({ label: 'Org', value: orgName });
    if (userName) row({ label: 'User', value: userName });
    row({ label: 'Device', value: config.deviceName ?? os.hostname() });

    // Session counts
    const sessionLabel = `${sessionCount} synced${pendingCount > 0 ? `, ${pendingCount} pending` : ''}`;
    row({ label: 'Sessions', value: sessionLabel });

    // Scanner info
    const claudeScanner = new ClaudeScanner();
    const claudeAvailable = await claudeScanner.isAvailable();
    if (claudeAvailable) {
      try {
        const claudeSessions = await claudeScanner.scan();
        row({
          label: 'Claude Code',
          value: pc.green('✓ Scanning') + pc.dim(` (${claudeSessions.length} sessions found)`),
        });
      } catch {
        row({ label: 'Claude Code', value: pc.yellow('⚠ Available but scan failed') });
      }
    } else {
      row({ label: 'Claude Code', value: pc.dim('— ~/.claude not found') });
    }

    const cursorScanner = new CursorScanner();
    const cursorAvailable = await cursorScanner.isAvailable();
    if (cursorAvailable) {
      try {
        const cursorSessions = await cursorScanner.scan();
        row({
          label: 'Cursor',
          value: pc.green('✓ Scanning') + pc.dim(` (${cursorSessions.length} sessions found)`),
        });
      } catch {
        row({ label: 'Cursor', value: pc.yellow('⚠ Available but scan failed') });
      }
    } else {
      row({ label: 'Cursor', value: pc.dim('— Cursor not found') });
    }

    // Paths
    row({ label: 'Config', value: pc.dim(getConfigPath()) });
    if (installed) {
      row({ label: 'Logs', value: pc.dim(getLogPath()) });
    }

    console.log();
  });
