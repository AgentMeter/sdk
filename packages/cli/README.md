# @agentmeter/cli

Track the tokens your AI coding sessions use. Reads the session data that Claude Code and Cursor already write to your machine — token counts, model, duration, project — and exposes it as an MCP server your AI agent can query directly.

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

> **Claude Code CLI only:** if you use the `claude` terminal app (not the VS Code extension), the server also registers two slash commands — `/mcp__agentmeter__sessions` and `/mcp__agentmeter__spend` — that inject live data directly into your conversation. These are not available in the VS Code extension or Cursor.

### Available tools (no account needed)

| Tool | Description |
|------|-------------|
| `list_recent_sessions` | Sessions from the last 12 months, sorted newest first. Includes token counts (input/output/cache) and `totalTokens`, duration, turns, model, engine, and repo. `synced` shows whether the session is on your AgentMeter dashboard. |
| `get_session` | Look up a session by ID from local data. Same fields as above. Falls back to the AgentMeter API if not found locally (requires account). |

Example questions your agent can answer with no account:

> "Show me my last 10 Claude Code sessions."
> "Which session used the most tokens this week?"
> "What's my total token usage across the last 20 sessions?"
> "Show me my recent Cursor sessions on the `my-app` repo."

---

## Unlock dashboards, trends, and team visibility

Connecting to [AgentMeter](https://agentmeter.app) puts your sessions next to your CI agent runs in one dashboard, with token trends over time and team-level visibility.

AgentMeter reports tokens, not dollars. Seat plans, subscriptions, and negotiated rates make list-price cost estimates wrong for most teams, so we don't show them.

### What you get

- **Web dashboard** — session history, per-repo and per-model token breakdowns, outcomes and quality ratings
- **Token trends** — daily usage by token type and cache hit rate, queryable via MCP (Pro)
- **Team visibility** — connected engineers, session counts, and each person's share of team tokens (Pro)

### Connect in 30 seconds

Sign in at [agentmeter.app](https://agentmeter.app) with GitHub, generate a personal API key under **Settings → API Keys**, then:

```bash
npx @agentmeter/cli init
npx @agentmeter/cli sync      # submit your sessions to the dashboard
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
| `get_session` (API fallback) | Fetches a session from the API when not in local data — by local session ID or AgentMeter run ID. |
| `get_my_spend` | Token usage summary + daily time series for the last 7–90 days. Returns `totalTokens`, `totalRuns`, `avgTokensPerRun`, `cacheHitRate`, and a per-day breakdown by token type. Pro plan. |
| `get_team_spend` | Per-contributor breakdown sorted by tokens — `login`, `totalTokens`, `runCount`, `avgTokensPerRun`, `tokenShareFraction`, `connectionStatus`. Pro plan. |

Example questions unlocked with an account:

> "How many tokens did I use this week, and what's my cache hit rate?"
> "Which days this month had unusually heavy usage?"
> "Who on my team used the most tokens in the last 30 days?"

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
| `--verbose` | Show each session's status, tokens, and duration |
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
