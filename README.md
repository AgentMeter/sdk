# AgentMeter Packages

[AgentMeter](https://agentmeter.app) tracks AI coding agent usage and costs across your team — giving you visibility into how tools like Claude Code and Cursor are being used, by whom, and at what cost.

This is the pnpm monorepo for AgentMeter's open-source packages.

## Packages

| Package | Description |
| ------- | ----------- |
| [`@agentmeter/cli`](packages/cli) | CLI for syncing local AI coding session data to AgentMeter |

## Stack

- **Language:** TypeScript (strict mode, ESM)
- **Package manager:** pnpm workspaces
- **Monorepo orchestration:** Turborepo
- **Linting/formatting:** Biome
- **Testing:** Vitest
- **Bundling:** tsup

## Root Commands

| Command | Description |
|---|---|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | TypeScript strict check across all packages |
| `pnpm lint` | Biome lint check |
| `pnpm lint:fix` | Biome auto-fix |
