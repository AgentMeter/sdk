import { Command } from 'commander';
import pc from 'picocolors';
import { getEffectiveConfig } from '../services/config.js';
import { installLinux, installMacos } from '../services/service-installer.js';
import { getLogPath } from '../utils/platform.js';
import { getPlatform } from '../utils/platform.js';
import { runSync } from './sync.js';

export const installCommand = new Command('install')
  .description('Install AgentMeter as a background service')
  .action(async () => {
    const config = getEffectiveConfig();
    if (!config) {
      console.error(pc.red('Error: No API key configured. Run `agentmeter init` first.'));
      process.exit(1);
    }

    const platform = getPlatform();

    if (platform === 'windows') {
      console.log(pc.yellow('Windows is not supported for background service installation.'));
      console.log(pc.yellow('Use WSL, or run `npx @agentmeter/cli watch` manually.'));
      process.exit(0);
    }

    if (platform === 'unsupported') {
      console.log(pc.yellow('This platform does not support automatic service installation.'));
      console.log(pc.yellow('Run `npx @agentmeter/cli watch` to sync in the foreground.'));
      process.exit(0);
    }

    try {
      console.log('Installing AgentMeter service...');

      if (platform === 'macos') {
        installMacos(config);
      } else {
        installLinux(config);
      }

      console.log('\nRunning initial sync...');
      await runSync({ verbose: false });

      const logPath = getLogPath();
      console.log(`\n${pc.green('✓ AgentMeter service installed')}`);
      console.log('  Syncing every 5 minutes in the background.');
      console.log('  Runs on login, survives reboots.');
      console.log(`  Logs: ${pc.dim(logPath)}\n`);
      console.log(`  Run ${pc.cyan('`npx @agentmeter/cli status`')} to check service health.`);
      console.log(`  Run ${pc.cyan('`npx @agentmeter/cli uninstall`')} to remove.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`\nError installing service: ${message}`));
      process.exit(1);
    }
  });
