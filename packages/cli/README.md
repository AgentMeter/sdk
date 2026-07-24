# @agentmeter/cli

Track what your AI coding sessions actually cost. `@agentmeter/cli` scans your local Claude Code and Cursor session data, calculates per-session token costs, and syncs them to [AgentMeter](https://agentmeter.app?utm_source=github&utm_medium=readme-package-cli&utm_campaign=agentmeter-sdk) - giving you and your team a unified dashboard of AI spend across tools, projects, and engineers.

No proxying. No API key sharing. The CLI reads session data that the agents already write to your machine.

- **Claude Code** — parses JSONL conversation logs in `~/.claude/projects/`, extracting exact token counts from the recorded Anthropic API responses.
- **Cursor** — reads the local SQLite state database across all three storage formats Cursor has used. Counts are approximate (Cursor is subscription-based and doesn't expose exact billing data locally).

Sessions are tracked by ID, so re-syncing is safe — existing records update rather than duplicate.

---

## MCP server — quick start (no account needed)

`agentmeter mcp` starts a stdio MCP server that any MCP-compatible agent (Claude Code, Cursor, etc.) can connect to. The local session tool works with no account and no API key.

### 1. Sync your sessions once

```bash
npx @agentmeter/cli sync
```

This reads session data from Claude Code / Cursor and writes a local cache to `~/.agentmeter/sync-state.json`. The MCP server reads from this file — no network required for basic usage.

> **Tip:** Run `npx @agentmeter/cli install` to set up a background service that syncs automatically every 5 minutes so the local data stays fresh.

### 2. Add to your MCP client

**Claude Code** — add to `~/.claude.json` (or run `claude mcp add`):

```json
{
  "mcpServers": {
    "agentmeter": {
      "command": "npx",
      "args": ["@agentmeter/cli", "mcp"]
    }
  }
}
```

**Cursor** — add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "agentmeter": {
      "command": "npx",
      "args": ["@agentmeter/cli", "mcp"]
    }
  }
}
```

### 3. Ask your agent about your sessions

> "How much did my last 5 Claude Code sessions cost?"
> "What's my most expensive session this week?"
> "Show me my recent Cursor sessions."

The `list_recent_sessions` tool returns local data instantly with no network call.

---

## Why

Engineering teams are adopting AI coding agents faster than they can track the cost. Provider dashboards show an aggregate monthly number; they can't tell you which engineer, which project, or which task drove the spend. AgentMeter is the attribution layer - visibility before the bill arrives, not after.

## Requirements

- **Node.js 22.5+** — the Cursor scanner uses `node:sqlite`, built in as of 22.5.
- **macOS or Linux** — full support including background service. On Windows, `sync` works manually but `install`/`uninstall` (launchd/systemd) do not.

## Quick Start (full sync to dashboard)

```bash
# 1. Get your API key from https://agentmeter.app/settings/api-keys
# 2. Initialize
npx @agentmeter/cli init

# 3. Sync once to confirm it works
npx @agentmeter/cli sync --dry-run   # preview without sending
npx @agentmeter/cli sync             # actually sync

# 4. Install as a background service so it runs automatically
npx @agentmeter/cli install
```

## Getting your API key

Sign in at [agentmeter.app](https://agentmeter.app) with GitHub and generate a **personal API key** under Settings → API Keys. Personal keys attribute sessions to you specifically, so your costs show up correctly in team views. (Org-level keys work too, but sessions submitted with them won't be attributed to an individual.)

## Commands

| Command     | Description                             |
| ----------- | --------------------------------------- |
| `init`      | Configure API key and device name       |
| `sync`      | One-time scan and upload                |
| `watch`     | Background daemon mode (foreground loop) |
| `install`   | Install as system service (macOS/Linux) |
| `uninstall` | Remove system service                   |
| `upgrade`   | Reinstall service from current binary   |
| `status`    | Show service and sync health            |
| `mcp`       | Start MCP stdio server                  |

### `sync` flags

| Flag | Description |
|---|---|
| `--verbose` | Show each session's status (cost, duration, new/updated/unchanged) |
| `--dry-run` | Show what would be submitted without sending anything |
| `--since <date>` | Only sync sessions after this date (ISO 8601) |
| `--engine <name>` | Only run a specific scanner (e.g. `claude`, `cursor`) |

### `watch` flags

| Flag | Description |
|---|---|
| `--interval <seconds>` | Sync interval in seconds (default: 300) |

## Running as a background service

`install` sets up the CLI to sync automatically every 5 minutes, survive reboots, and start on login — so neither you nor your teammates have to remember to run it.

- **macOS** — installs a launchd agent (`~/Library/LaunchAgents/`).
- **Linux** — installs a systemd user service.

Check it's healthy anytime:

```bash
npx @agentmeter/cli status
```

Remove it cleanly (config is preserved):

```bash
npx @agentmeter/cli uninstall
```

## MCP server (full reference)

`agentmeter mcp` starts a stdio MCP server so any MCP-compatible AI agent can query your session history and spend data as tools — staying in their workflow without switching to a dashboard.

### Available tools

| Tool | Needs API key? | Description |
|------|:-:|---|
| `list_recent_sessions` | No | Returns last N sessions from local cache, sorted by recency |
| `get_session` | Local: No / API fallback: Yes | Looks up a session by ID; checks local cache first |
| `get_my_spend` | Yes | Spend summary + daily time series for the last N days |
| `get_team_spend` | Yes (Pro) | Per-contributor breakdown for the last N days |

### Using without an account

`list_recent_sessions` and the local-cache path of `get_session` both work with zero configuration. Run `agentmeter sync` (or install the background service) once so the local cache is populated, then connect your MCP client.

When you call a tool that requires an API key without one configured, the tool returns a helpful error with a sign-up link rather than crashing the server:

```json
{
  "error": "AgentMeter API key required",
  "hint": "Run `agentmeter init` to configure your API key, or set the AGENTMETER_API_KEY env var. Sign up free at https://agentmeter.app"
}
```

### Adding your API key

**Option A — run init (recommended):**

```bash
npx @agentmeter/cli init
```

This writes `~/.agentmeter/config.json`. The MCP server reads it automatically on each tool call.

**Option B — environment variable in your MCP config:**

```json
{
  "mcpServers": {
    "agentmeter": {
      "command": "npx",
      "args": ["@agentmeter/cli", "mcp"],
      "env": {
        "AGENTMETER_API_KEY": "am_sk_your_key_here"
      }
    }
  }
}
```

This is handy for per-project configurations or CI environments. `AGENTMETER_API_KEY` always takes precedence over the config file.

### Tool reference

#### `list_recent_sessions`

Returns the last N sessions from `~/.agentmeter/sync-state.json`. No API call made.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer 1–50 | `10` | Number of sessions to return |

Each session record includes: `sessionId`, `title`, `engine`, `model`, `repoFullName`, `status`, `startTime`, `submittedAt`, `costCents` (null if unknown).

#### `get_my_spend`

Fetches spend summary and daily time series from `GET /api/trends`. Requires API key.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | integer 1–365 | `7` | Look-back window in days |

Returns: `summary.totalCostCents`, `summary.totalRuns`, `summary.avgCostPerRunCents`, and `timeSeries` (array of `{ date, costCents, runs }`).

#### `get_session`

Looks up a session by ID. Checks local cache first; if not found and an API key is configured, calls `GET /api/runs/<sessionId>`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID to look up |

Returns: `sessionId`, `source` (`"local"` or `"api"`), `costCents`, `model`, `engine`, `status`, `title`, `startTime`/`durationSeconds`.

#### `get_team_spend`

Fetches per-contributor spend from `GET /api/contributors`. Requires Pro plan + API key.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | integer 1–365 | `30` | Look-back window in days |

Returns array of `{ login, totalCostCents, totalRuns, connectionStatus }`.

## Upgrading

If you have the background service running and want to update to the latest version:

**npx (no global install):**

```bash
npx @agentmeter/cli@latest upgrade
```

**Global install:**

```bash
npm install -g @agentmeter/cli@latest
agentmeter upgrade
```

`upgrade` stops the current service, reinstalls it pointing at the new binary, and starts it again. Config and sync state are preserved.

## For teams

Rolling this out across a team? Add `npx @agentmeter/cli init` and
`npx @agentmeter/cli install` to your onboarding script or setup docs. Each engineer uses their own personal API key, so the dashboard attributes spend per person automatically. The team admin can see coverage - who's set up and who hasn't - in the AgentMeter dashboard.

## Environment Variables

- `AGENTMETER_API_KEY` — overrides the API key in config
- `AGENTMETER_API_URL` — overrides the API URL (useful for local dev)

## Privacy

AgentMeter stores session metadata and token counts — never your code, prompts, or conversation content. The CLI only extracts: token counts, model, timestamps, duration, project path, and the first line of the session as a title. Nothing else leaves your machine.

## Supported Agents

| Agent       | Token data                          |
| ----------- | ----------------------------------- |
| Claude Code | Exact (from Anthropic API response) |
| Cursor      | Approximate (subscription-based)    |

## Links

- [AgentMeter dashboard](https://agentmeter.app)
- [How it works](https://agentmeter.app/how-it-works)
