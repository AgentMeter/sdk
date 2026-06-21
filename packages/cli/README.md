# @agentmeter/cli

Track what your AI coding sessions actually cost. `@agentmeter/cli` scans your local Claude Code and Cursor session data, calculates per-session token costs, and syncs them to [AgentMeter](https://agentmeter.app) - giving you and your team a unified dashboard of AI spend across tools, projects, and engineers.

No proxying. No API key sharing. The CLI reads session data that the agents already write to your machine.

- **Claude Code** — parses JSONL conversation logs in `~/.claude/projects/`, extracting exact token counts from the recorded Anthropic API responses.
- **Cursor** — reads the local SQLite state database across all three storage formats Cursor has used. Counts are approximate (Cursor is subscription-based and doesn't expose exact billing data locally).

Sessions are tracked by ID, so re-syncing is safe — existing records update rather than duplicate.

## Why

Engineering teams are adopting AI coding agents faster than they can track the cost. Provider dashboards show an aggregate monthly number; they can't tell you which engineer, which project, or which task drove the spend. AgentMeter is the attribution layer - visibility before the bill arrives, not after.

## Requirements

- **Node.js 22.5+** — the Cursor scanner uses `node:sqlite`, built in as of 22.5.
- **macOS or Linux** — full support including background service. On Windows, `sync` works manually but `install`/`uninstall` (launchd/systemd) do not.

## Quick Start

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