import os from 'node:os';
import { Command } from 'commander';
import pc from 'picocolors';
import { ClaudeScanner } from '../scanners/claude.js';
import { ApiClient } from '../services/api.js';
import { getEffectiveConfig } from '../services/config.js';
import { isServiceInstalled, isServiceRunning } from '../services/service-installer.js';
import { readSyncState } from '../services/sync-state.js';
import { formatRelativeTime } from '../utils/format.js';
import { getConfigPath, getLogPath } from '../utils/platform.js';

/**
 * Prints a padded label/value row for the status display
 */
function row(label: string, value: string): void {
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
    row('Service', serviceLabel);

    if (!config) {
      row('API key', pc.red('✗ Not configured (run `agentmeter init`)'));
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

    row('API key', keyLabel);
    if (orgName) row('Org', orgName);
    if (userName) row('User', userName);
    row('Device', config.deviceName ?? os.hostname());

    // Session counts
    const sessionLabel = `${sessionCount} synced${pendingCount > 0 ? `, ${pendingCount} pending` : ''}`;
    row('Sessions', sessionLabel);

    // Scanner info
    const claudeScanner = new ClaudeScanner();
    const claudeAvailable = await claudeScanner.isAvailable();
    if (claudeAvailable) {
      try {
        const claudeSessions = await claudeScanner.scan();
        row(
          'Claude Code',
          pc.green('✓ Scanning') + pc.dim(` (${claudeSessions.length} sessions found)`),
        );
      } catch {
        row('Claude Code', pc.yellow('⚠ Available but scan failed'));
      }
    } else {
      row('Claude Code', pc.dim('— ~/.claude not found'));
    }

    row('Cursor', pc.dim('— Not yet supported'));

    // Paths
    row('Config', pc.dim(getConfigPath()));
    if (installed) {
      row('Logs', pc.dim(getLogPath()));
    }

    console.log();
  });
