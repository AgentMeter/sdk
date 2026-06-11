# AgentMeter CLI

## Project Overview
A CLI tool that scans local AI coding agent session data (Claude Code, Cursor)
and submits session cost data to the AgentMeter API. Published as @agentmeter/cli on npm.

## Tech Stack
- Language: TypeScript (strict mode, ESM)
- Package manager: pnpm
- Monorepo: pnpm workspaces + Turborepo
- Linting/formatting: Biome (not ESLint/Prettier)
- Testing: Vitest
- Validation: Zod
- Bundling: tsup
- CLI framework: commander
- Terminal colors: picocolors

## Key Conventions
- All code is ESM (type: "module" in package.json)
- No `any` — use `unknown` and narrow with type guards or Zod
- Zod schemas are the source of truth for all external data shapes (API responses, config files, JSONL events)
- Defensive parsing everywhere — the Claude Code JSONL format is undocumented and may change. Never crash on unexpected data.
- All file paths use `node:path` and `node:os` for cross-platform compatibility (macOS + Linux)
- Error handling: the CLI should never crash with an unhandled exception. Catch, log, continue.
- Use `node:` protocol prefix for all built-in module imports
- `noUncheckedIndexedAccess` is enabled — array index access returns `T | undefined`

## Commands
- `pnpm build` — build all packages
- `pnpm lint` — Biome check
- `pnpm lint:fix` — Biome auto-fix
- `pnpm typecheck` — TypeScript strict check
- `pnpm test` — run all tests

## File Structure
All CLI source lives in packages/cli/src/.
Tests live in packages/cli/__tests__/ mirroring the src directory structure.
Test fixtures (sample JSONL files) live in packages/cli/__tests__/fixtures/.

## Testing Guidelines
- Use Vitest (not Jest) — import from 'vitest': vi, describe, it, expect, beforeEach
- Test the scanner against real-shaped JSONL fixtures in __tests__/fixtures/
- Test the API client with mocked fetch (vi.stubGlobal)
- Test config and sync-state with tmp directories
- All tests must pass in the pre-commit hook — keep them fast (< 10s total)

## API
- Base URL: https://agentmeter.app (overridable via AGENTMETER_API_URL)
- Auth: `Authorization: Bearer <apiKey>`
- Validate key: `GET /api/auth/me`
- Submit session: `POST /api/ingest/local`
