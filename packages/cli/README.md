# @agentmeter/cli

Track what your AI coding sessions cost. `@agentmeter/cli` reads the session data that Claude Code and Cursor already write to your machine — token counts, model, duration, project — and gives you a local history of every session and its cost. No proxying, no account required.

- **Claude Code** — parses JSONL conversation logs in `~/.claude/projects/`, extracting exact token counts from the recorded Anthropic API responses.
- **Cursor** — reads the local SQLite state database. Counts are approximate (Cursor is subscription-based and doesn't expose exact billing data locally).

## Requirements

- **Node.js 22.5+** — the Cursor scanner uses `node:sqlite`, built in as of 22.5.
- **macOS or Linux** — full support. On Windows, `sync` works manually but `install`/`uninstall` do not.

---

## Quick start

```bash
# Scan your sessions once
npx @agentmeter/cli sync

# Install as a background service — auto-syncs every 5 minutes
npx @agentmeter/cli install
```

That's it. Sessions are now tracked in `~/.agentmeter/sync-state.json` and kept up to date automatically.

## Commands

| Command     | Description                                        |
| ----------- | -------------------------------------------------- |
| `sync`      | Scan local sessions and update the local cache     |
| `install`   | Install as a system service (macOS/Linux)          |
| `uninstall` | Remove the system service                          |
| `watch`     | Run the sync loop in the foreground                |
| `upgrade`   | Reinstall the service from the current binary      |
| `status`    | Show service health and session counts             |
| `mcp`       | Start an MCP stdio server (see below)              |
| `init`      | Configure an AgentMeter API key (see below)        |

### `sync` flags

| Flag | Description |
|---|---|
| `--verbose` | Show each session's status, cost, and duration |
| `--dry-run` | Preview what would be synced without writing anything |
| `--since <date>` | Only include sessions after this date (ISO 8601) |
| `--engine <name>` | Only run a specific scanner (`claude`, `cursor`) |

### Background service

`install` sets up the CLI to sync every 5 minutes, survive reboots, and start on login.

- **macOS** — installs a launchd agent (`~/Library/LaunchAgents/`)
- **Linux** — installs a systemd user service

```bash
npx @agentmeter/cli status    # check it's running
npx @agentmeter/cli uninstall # remove it (config and data are preserved)
```

---

## MCP server

`agentmeter mcp` starts a stdio MCP server so any MCP-compatible agent (Claude Code, Cursor, etc.) can query your session history directly as tools — without leaving their workflow.

### Setup

**Claude Code** — add to `~/.claude.json`:

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

**Cursor** — add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project):

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

### Tools available without an account

These tools read from your local `~/.agentmeter/sync-state.json` — no API key, no network call.

| Tool | Description |
|------|-------------|
| `list_recent_sessions` | Returns the last N sessions (default 10, max 50) sorted by recency. Each result includes `sessionId`, `title`, `engine`, `model`, `repoFullName`, `status`, `startTime`, `tokens` (input/output/cache counts), and `costCents`\*. |
| `get_session` | Looks up a session by ID from the local cache and returns the same fields. |

\* `costCents` requires an AgentMeter account (see below). Token counts are always available locally.

Example questions your agent can answer locally:

> "Show me my last 10 Claude Code sessions."
> "Which of my recent sessions used the most tokens?"
> "What's the total token spend across my last 20 sessions?"
> "List my recent Cursor sessions on the `my-app` repo."

---

## Unlock dashboards, trends, and team visibility

The local cache is useful on its own, but connecting to [AgentMeter](https://agentmeter.app) gives you cost data per session, a web dashboard, spend trends over time, and team-level visibility across engineers and projects.

### What you get

- **Cost per session** — `costCents` is calculated by the API and written back to your local cache, so the `list_recent_sessions` MCP tool also shows costs once you're connected.
- **Web dashboard** — session history, per-repo breakdowns, and model-level spend.
- **Trends** — daily and weekly spend charts queryable via MCP.
- **Team visibility** — see connected engineers, their session counts, and spend (Pro).

### Connect in 30 seconds

Sign in at [agentmeter.app](https://agentmeter.app) with GitHub and generate a personal API key under **Settings → API Keys**, then:

```bash
npx @agentmeter/cli init
```

Or set the environment variable directly in your MCP config if you prefer not to run `init`:

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

### Additional MCP tools with an account

| Tool | Description |
|------|-------------|
| `get_session` (API fallback) | If a session isn't in the local cache, fetches it from the API by ID. |
| `get_my_spend` | Spend summary + daily time series for the last N days. Returns `totalCostCents`, `totalRuns`, `avgCostPerRunCents`, and a per-day breakdown. |
| `get_team_spend` | Per-contributor breakdown — `login`, `totalCostCents`, `totalRuns`, `connectionStatus`. Pro plan. |

Example questions unlocked with an account:

> "How much have I spent on Claude Code this week?"
> "What was the cost of session `abc123`?"
> "Show me my team's AI spend for the last 30 days."

### For teams

Each engineer runs `agentmeter init` with their own personal API key. Sessions are attributed automatically, and the team admin sees coverage (who's connected) and spend per person in the dashboard.

---

## Environment variables

| Variable | Description |
|---|---|
| `AGENTMETER_API_KEY` | API key — overrides the value in `~/.agentmeter/config.json` |
| `AGENTMETER_API_URL` | Override the API base URL (useful for self-hosting or local dev) |

## Privacy

AgentMeter stores session metadata and token counts — never your code, prompts, or conversation content. The CLI extracts: token counts, model, timestamps, duration, project path, and the first line of the session as a title. Nothing else leaves your machine.

## Supported agents

| Agent       | Token data                          |
| ----------- | ----------------------------------- |
| Claude Code | Exact (from Anthropic API response) |
| Cursor      | Approximate (subscription-based)    |

## Links

- [AgentMeter dashboard](https://agentmeter.app)
- [How it works](https://agentmeter.app/how-it-works)
