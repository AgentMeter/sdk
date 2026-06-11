Review the current code changes for issues.

Check for:
- TypeScript type safety (no `any`, proper narrowing, `noUncheckedIndexedAccess` compliance)
- Defensive parsing of external data (JSONL, API responses, config files)
- Cross-platform compatibility (macOS + Linux paths, no hardcoded OS separators)
- Error handling (no unhandled exceptions, graceful degradation)
- Test coverage for new functionality
- Biome lint compliance

Run `pnpm lint && pnpm typecheck && pnpm test` and fix any issues found.
