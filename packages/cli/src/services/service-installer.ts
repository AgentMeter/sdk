import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../schemas/config.js';
import { getLogDir, getLogPath } from '../utils/platform.js';

const LAUNCHD_LABEL = 'com.agentmeter.sync';
const SYSTEMD_SERVICE = 'agentmeter';

function getLaunchdPlistPath(): string {
  const home = process.env.HOME ?? '';
  return path.join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function getSystemdServicePath(): string {
  const home = process.env.HOME ?? '';
  return path.join(home, '.config', 'systemd', 'user', `${SYSTEMD_SERVICE}.service`);
}

function findBinaryPath(): string {
  try {
    const result = execFileSync('which', ['agentmeter'], { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch {
    // which failed — fall back to current script path
  }
  return process.argv[1] ?? 'agentmeter';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generatePlist(binaryPath: string, apiKey: string, logPath: string): string {
  const nodePath = process.execPath;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(LAUNCHD_LABEL)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(nodePath)}</string>
        <string>${escapeXml(binaryPath)}</string>
        <string>watch</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENTMETER_API_KEY</key>
        <string>${escapeXml(apiKey)}</string>
    </dict>
</dict>
</plist>
`;
}

function generateSystemdUnit(binaryPath: string, apiKey: string): string {
  const nodePath = process.execPath;
  return `[Unit]
Description=AgentMeter Session Sync

[Service]
Type=simple
ExecStart=${nodePath} ${binaryPath} watch
Restart=on-failure
RestartSec=30
Environment=AGENTMETER_API_KEY=${apiKey}

[Install]
WantedBy=default.target
`;
}

export function installMacos(config: Config): void {
  const binaryPath = findBinaryPath();
  const logDir = getLogDir();
  const logPath = getLogPath();
  const plistPath = getLaunchdPlistPath();

  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });

  const plist = generatePlist(binaryPath, config.apiKey, logPath);
  fs.writeFileSync(plistPath, plist, 'utf8');

  // Unload first in case it was previously installed
  spawnSync('launchctl', ['unload', plistPath]);
  spawnSync('launchctl', ['load', plistPath]);
}

export function uninstallMacos(): void {
  const plistPath = getLaunchdPlistPath();
  spawnSync('launchctl', ['unload', plistPath]);
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
}

export function installLinux(config: Config): void {
  const binaryPath = findBinaryPath();
  const servicePath = getSystemdServicePath();

  fs.mkdirSync(path.dirname(servicePath), { recursive: true });

  const unit = generateSystemdUnit(binaryPath, config.apiKey);
  fs.writeFileSync(servicePath, unit, 'utf8');

  spawnSync('systemctl', ['--user', 'daemon-reload']);
  spawnSync('systemctl', ['--user', 'enable', SYSTEMD_SERVICE]);
  spawnSync('systemctl', ['--user', 'start', SYSTEMD_SERVICE]);
}

export function uninstallLinux(): void {
  const servicePath = getSystemdServicePath();
  spawnSync('systemctl', ['--user', 'stop', SYSTEMD_SERVICE]);
  spawnSync('systemctl', ['--user', 'disable', SYSTEMD_SERVICE]);
  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
  }
  spawnSync('systemctl', ['--user', 'daemon-reload']);
}

export function isServiceRunning(): boolean {
  if (process.platform === 'darwin') {
    const result = spawnSync('launchctl', ['list', LAUNCHD_LABEL], { encoding: 'utf8' });
    return result.status === 0;
  }
  if (process.platform === 'linux') {
    const result = spawnSync('systemctl', ['--user', 'is-active', SYSTEMD_SERVICE], {
      encoding: 'utf8',
    });
    return (result.stdout ?? '').trim() === 'active';
  }
  return false;
}

export function isServiceInstalled(): boolean {
  if (process.platform === 'darwin') {
    return fs.existsSync(getLaunchdPlistPath());
  }
  if (process.platform === 'linux') {
    return fs.existsSync(getSystemdServicePath());
  }
  return false;
}
