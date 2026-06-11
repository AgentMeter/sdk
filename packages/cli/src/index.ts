import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { installCommand } from './commands/install.js';
import { statusCommand } from './commands/status.js';
import { syncCommand } from './commands/sync.js';
import { uninstallCommand } from './commands/uninstall.js';
import { watchCommand } from './commands/watch.js';

const program = new Command();

program
  .name('agentmeter')
  .description('Track local AI coding agent session costs — Claude Code, Cursor, and more')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(syncCommand);
program.addCommand(watchCommand);
program.addCommand(installCommand);
program.addCommand(uninstallCommand);
program.addCommand(statusCommand);

program.parse();
