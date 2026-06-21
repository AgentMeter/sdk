import { Command } from 'commander';
import pc from 'picocolors';
import { getEffectiveConfig } from '../services/config.js';
import {
  installLinux,
  installMacos,
  isServiceInstalled,
  uninstallLinux,
  uninstallMacos,
} from '../services/service-installer.js';
import { getLogPath } from '../utils/platform.js';
import { getPlatform } from '../utils/platform.js';
import { runSync } from './sync.js';

/**
 * Stops the running service, reinstalls it from the current binary, and starts it again.
 * Config and sync state are preserved. Intended to be run as:
 *   npx @agentmeter/cli@latest upgrade   (npx users)
 *   agentmeter upgrade                   (global install users)
 */
export const upgradeCommand = new Command('upgrade')
  .description('Reinstall the background service from the current binary (use after updating the CLI)')
  .action(async () => {
    const platform = getPlatform();

    if (platform === 'windows' || platform === 'unsupported') {
      console.log(pc.yellow('Background service is not supported on this platform.'));
      process.exit(0);
    }

    if (!isServiceInstalled()) {
      console.log(pc.yellow('AgentMeter service is not installed.'));
      console.log(pc.dim('  Run `npx @agentmeter/cli install` to set it up first.'));
      process.exit(0);
    }

    const config = getEffectiveConfig();
    if (!config) {
      console.error(pc.red('Error: No API key configured. Run `agentmeter init` first.'));
      process.exit(1);
    }

    try {
      console.log('Stopping current service...');
      if (platform === 'macos') {
        uninstallMacos();
      } else {
        uninstallLinux();
      }

      console.log('Reinstalling service from current binary...');
      if (platform === 'macos') {
        installMacos(config);
      } else {
        installLinux(config);
      }

      console.log('\nRunning initial sync...');
      await runSync({ verbose: false });

      const logPath = getLogPath();
      console.log(`\n${pc.green('✓ AgentMeter service upgraded and restarted')}`);
      console.log('  Config and sync state preserved.');
      console.log(`  Logs: ${pc.dim(logPath)}\n`);
      console.log(`  Run ${pc.cyan('`npx @agentmeter/cli status`')} to verify.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`\nError upgrading service: ${message}`));
      process.exit(1);
    }
  });
