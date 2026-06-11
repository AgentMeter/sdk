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

| Command | Description |
|---|---|
| `init` | Configure API key and device name |
| `sync` | One-time scan and upload |
| `watch` | Background daemon mode |
| `install` | Install as system service (macOS/Linux) |
| `uninstall` | Remove system service |
| `status` | Show service and sync health |

## Options

All commands respect these environment variables:

- `AGENTMETER_API_KEY` — overrides the API key in config
- `AGENTMETER_API_URL` — overrides the API URL (useful for local dev)

## Supported Agents

| Agent | Status |
|---|---|
| Claude Code | ✓ Supported |
| Cursor | Coming soon |

## Documentation

https://agentmeter.app/docs/cli
