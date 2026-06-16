# @agentmeter/cli

`@agentmeter/cli` scans your local AI coding agent data, calculates per-session token costs, and syncs them to [AgentMeter](https://agentmeter.app) — giving you a unified dashboard of AI spend across tools and projects.

It reads session data directly from the agents installed on your machine (no proxying, no API key sharing):

- **Claude Code** — parses JSONL conversation logs written to `~/.claude/projects/`, extracting exact token counts from the Anthropic API responses recorded there.
- **Cursor** — reads the local SQLite state database, extracting token usage across all three storage formats Cursor has used. Token counts are approximate since Cursor is subscription-based and doesn't expose exact API billing data locally.

On each sync, the CLI submits session records to the [AgentMeter](https://agentmeter.app) ingest API (`POST /api/ingest/local`), which calculates costs against the current model pricing matrix and makes them visible in your dashboard. Sessions are tracked by ID so re-syncing is safe — existing records are updated, not duplicated.

## Requirements

- **Node.js 22.5+** — the Cursor scanner uses `node:sqlite`, a built-in module added in Node 22.5.
- **macOS or Linux** — scanning and background service installation are supported on both. Windows can run `sync` manually but `install`/`uninstall` (launchd / systemd) are not supported.

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

| Agent       | Token data                          |
| ----------- | ----------------------------------- |
| Claude Code | Exact (from Anthropic API response) |
| Cursor      | Approximate (subscription-based)    |
