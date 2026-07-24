# @agentmeter/cli

Track what your AI coding sessions cost. Reads the session data that Claude Code and Cursor already write to your machine — token counts, model, duration, project — and exposes it as an MCP server your AI agent can query directly.

No account required. No setup beyond two lines of JSON.

---

## MCP server (no account needed)

Add to your MCP client config and start asking questions. The server scans your local Claude Code and Cursor data on demand — no prior sync, no background service, nothing to install first.

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

The first call scans your local data (takes a moment). Subsequent calls within 60 seconds return instantly from the in-memory cache.

### Slash commands

Once connected, these are available as slash commands in your AI agent:

| Command | Description |
|---------|-------------|
| `/mcp__agentmeter__sessions` | Show recent sessions — token usage, duration, model. Optional: `limit` |
| `/mcp__agentmeter__spend` | Show spend summary and daily breakdown (requires account). Optional: `days` |

### Available tools (no account needed)

| Tool | Description |
|------|-------------|
| `list_recent_sessions` | Sessions from the last 12 months, sorted newest first. Includes token counts (input/output/cache), duration, model, engine, and repo. `costCents` is populated if you have an AgentMeter account (see below). |
| `get_session` | Look up a session by ID from local data. Same fields as above. Falls back to the AgentMeter API if not found locally (requires account). |

Example questions your agent can answer with no account:

> "Show me my last 10 Claude Code sessions."
> "Which session used the most tokens this week?"
> "What's my total token usage across the last 20 sessions?"
> "Show me my recent Cursor sessions on the `my-app` repo."

---

## Unlock cost data, dashboards, and team visibility

Connecting to [AgentMeter](https://agentmeter.app) gives you cost-per-session in dollars (not just tokens), a web dashboard, spend trends over time, and team-level visibility.

### What you get

- **`costCents` per session** — calculated by the API and returned to your local cache, so `list_recent_sessions` starts showing dollar costs too
- **Web dashboard** — session history, per-repo breakdowns, model-level spend
- **Spend trends** — daily and weekly charts queryable via MCP
- **Team visibility** — connected engineers, session counts, and spend (Pro)

### Connect in 30 seconds

Sign in at [agentmeter.app](https://agentmeter.app) with GitHub, generate a personal API key under **Settings → API Keys**, then:

```bash
npx @agentmeter/cli init
npx @agentmeter/cli sync      # submit your sessions and get cost data back
npx @agentmeter/cli install   # keep it syncing automatically every 5 minutes
```

Or pass the key via your MCP config without running `init`:

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
| `get_session` (API fallback) | Fetches a session from the API when not in local data. |
| `get_my_spend` | Spend summary + daily time series for the last N days. Returns `totalCostCents`, `totalRuns`, `avgCostPerRunCents`, and a per-day breakdown. |
| `get_team_spend` | Per-contributor breakdown — `login`, `totalCostCents`, `totalRuns`, `connectionStatus`. Pro plan. |

Example questions unlocked with an account:

> "How much have I spent on Claude Code this week?"
> "What's my average cost per session this month?"
> "Show me my team's AI spend for the last 30 days."

---

## Updating

**Using `npx` (default config):** npx caches the package. To always resolve the latest version, use `@latest` in your config args:

```json
{
  "mcpServers": {
    "agentmeter": {
      "command": "npx",
      "args": ["@agentmeter/cli@latest", "mcp"]
    }
  }
}
```

**Using a global install** (faster startup, explicit updates):

```bash
npm install -g @agentmeter/cli
```

Then use `agentmeter` as the command directly:

```json
{
  "mcpServers": {
    "agentmeter": {
      "command": "agentmeter",
      "args": ["mcp"]
    }
  }
}
```

To update: `npm install -g @agentmeter/cli@latest`

**After updating:** restart your MCP client (Claude Code, Cursor) — MCP servers are not hot-reloaded.

---

## CLI reference

The CLI is optional for MCP usage but required for background auto-sync and for submitting sessions to AgentMeter.

### Requirements

- **Node.js 22.5+** — the Cursor scanner uses `node:sqlite`, built in as of 22.5
- **macOS or Linux** — full support. On Windows, `sync` works manually but `install`/`uninstall` do not

### Commands

| Command     | Description                                        |
| ----------- | -------------------------------------------------- |
| `mcp`       | Start MCP stdio server                             |
| `sync`      | Scan local sessions and submit to AgentMeter       |
| `install`   | Install as a system service (macOS/Linux)          |
| `uninstall` | Remove the system service                          |
| `watch`     | Run the sync loop in the foreground                |
| `upgrade`   | Reinstall the service from the current binary      |
| `status`    | Show service health and session counts             |
| `init`      | Configure an AgentMeter API key                    |

### `sync` flags

| Flag | Description |
|---|---|
| `--verbose` | Show each session's status, cost, and duration |
| `--dry-run` | Preview what would be submitted without sending anything |
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

### Upgrading

```bash
npx @agentmeter/cli@latest upgrade   # npx — no global install
npm install -g @agentmeter/cli@latest && agentmeter upgrade  # global install
```

`upgrade` stops the service, reinstalls pointing at the new binary, and restarts. Config and sync state are preserved.

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
