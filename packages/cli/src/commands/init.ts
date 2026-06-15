import os from 'node:os';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import pc from 'picocolors';
import { ApiClient } from '../services/api.js';
import { writeConfig } from '../services/config.js';

/**
 * Returns a truncated preview of an API key safe for display in terminal output
 */
function maskKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 4)}...`;
  return `${key.slice(0, 8)}...`;
}

export const initCommand = new Command('init')
  .description('Configure your AgentMeter API key and device name')
  .action(async () => {
    const rl = createInterface({ input, output });

    try {
      console.log(pc.bold('\nAgentMeter CLI Setup\n'));

      const apiKey = (await rl.question('Enter your AgentMeter API key: ')).trim();
      if (!apiKey) {
        console.error(pc.red('Error: API key is required.'));
        process.exit(1);
      }

      const defaultDevice = os.hostname();
      const deviceInput = (await rl.question(`Device name [${defaultDevice}]: `)).trim();
      const deviceName = deviceInput || defaultDevice;

      rl.close();

      // Validate the API key
      process.stdout.write('\nValidating API key...');

      const tempConfig = {
        apiKey,
        deviceName,
        apiUrl: process.env.AGENTMETER_API_URL ?? 'https://agentmeter.app',
      };
      const client = new ApiClient(tempConfig);
      const validation = await client.validateKey();

      if (!validation.valid) {
        process.stdout.write(` ${pc.red('✗')}\n`);
        console.error(
          pc.red(
            '\nError: Invalid API key. Check your key at https://agentmeter.app/settings/api-keys',
          ),
        );
        process.exit(1);
      }

      process.stdout.write(` ${pc.green('✓')}\n\n`);

      if (validation.keyType === 'org') {
        console.log(
          pc.yellow('⚠ This is an org-level API key. Local sessions submitted with this key'),
        );
        console.log(pc.yellow('  will not be attributed to you in the dashboard.'));
        console.log(pc.yellow('\n  For contributor attribution, generate a personal API key at:'));
        console.log(pc.yellow('  https://agentmeter.app/settings/api-keys\n'));

        const rl2 = createInterface({ input, output });
        const answer = (await rl2.question('Continue anyway? (y/N) ')).trim();
        rl2.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted.');
          process.exit(0);
        }
        console.log();
      }

      console.log(pc.green('✓ API key valid'));
      if (validation.orgName) console.log(`  Org:  ${validation.orgName}`);
      if (validation.userName) console.log(`  User: ${validation.userName}`);
      console.log(`  Key:  ${maskKey(apiKey)}\n`);

      writeConfig({ apiKey, deviceName, apiUrl: tempConfig.apiUrl });

      console.log(`Config saved to ${pc.dim('~/.agentmeter/config.json')}`);
      console.log(
        `Run ${pc.cyan('`npx @agentmeter/cli install`')} to start syncing in the background.`,
      );
    } catch (err) {
      rl.close();
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`\nError: ${message}`));
      process.exit(1);
    }
  });
