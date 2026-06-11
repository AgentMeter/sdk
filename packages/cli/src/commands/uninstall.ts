import { Command } from 'commander';
import pc from 'picocolors';
import {
  isServiceInstalled,
  uninstallLinux,
  uninstallMacos,
} from '../services/service-installer.js';
import { getPlatform } from '../utils/platform.js';

export const uninstallCommand = new Command('uninstall')
  .description('Remove the AgentMeter background service')
  .action(() => {
    const platform = getPlatform();

    if (platform === 'windows' || platform === 'unsupported') {
      console.log(pc.yellow('No service to uninstall on this platform.'));
      process.exit(0);
    }

    if (!isServiceInstalled()) {
      console.log(pc.yellow('AgentMeter service is not installed.'));
      process.exit(0);
    }

    try {
      if (platform === 'macos') {
        uninstallMacos();
      } else {
        uninstallLinux();
      }

      console.log(pc.green('✓ AgentMeter service removed.'));
      console.log(pc.dim('  Config and sync state are preserved at ~/.agentmeter/'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Error removing service: ${message}`));
      process.exit(1);
    }
  });
