# @agentmeter/cli

Track local AI coding agent session costs — Claude Code, Cursor, and more.

## Quick Start

```bash
# Initialize with your API key
npx @agentmeter/cli init

# Sync sessions once
npx @agentmeter/cli sync

# Install as a background service
npx @agentmeter/cli install
```

## Commands

| Command     | Description                             |
| ----------- | --------------------------------------- |
| `init`      | Configure API key and device name       |
| `sync`      | One-time scan and upload                |
| `watch`     | Background daemon mode                  |
| `install`   | Install as system service (macOS/Linux) |
| `uninstall` | Remove system service                   |
| `status`    | Show service and sync health            |

### `sync` flags

| Flag | Description |
|---|---|
| `--verbose` | Show each session's status (cost, duration, new/updated/unchanged) |
| `--dry-run` | Show what would be submitted without sending anything |
| `--since <date>` | Only sync sessions after this date (ISO 8601) |
| `--engine <name>` | Only run a specific scanner (e.g. `claude`) |

### `watch` flags

| Flag | Description |
|---|---|
| `--interval <seconds>` | Sync interval in seconds (default: 300) |

## Environment Variables

All commands respect these environment variables:

- `AGENTMETER_API_KEY` — overrides the API key in config
- `AGENTMETER_API_URL` — overrides the API URL (useful for local dev)

## Supported Agents

| Agent       | Status      |
| ----------- | ----------- |
| Claude Code | ✓ Supported |
| Cursor      | Coming soon |
