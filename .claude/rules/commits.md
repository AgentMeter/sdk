---
description: Git commit and branching conventions
---

# Commits & Workflow

## Conventional commits

`type(scope): description`

Types: `feat` `fix` `docs` `style` `refactor` `test` `chore` `perf` `ci` `build`

## Rules

- Granular commits — small, cohesive changesets
- Always `git add .`; push after each commit
- Run `npm run type-check` before committing
- After modifying `package.json` or dependencies, run `npm install` to sync `package-lock.json` before committing
- Add a `.gitignore` when creating new apps or packages
