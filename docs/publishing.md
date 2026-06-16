# Publishing @agentmeter/cli to npm

Releases are triggered by publishing a GitHub Release. The workflow automatically determines the semantic version bump from the release title, bumps `packages/cli/package.json`, and publishes to npm.

---

## One-time setup

### 1. npm Automation token

> **TODO**: Replace with a dedicated `agentmeter-bot` npm account holding a no-expiry Classic Automation token. Invite the bot to the `agentmeter` org with publish permissions, generate the token from the bot account, and update `NPM_TOKEN` in GitHub Secrets. The current granular token expires in 90 days and must be manually rotated.

1. Go to [npmjs.com](https://www.npmjs.com) → avatar → **Access Tokens** → **Generate New Token**
2. Fill in the Granular Access Token form:
   - **Bypass 2FA**: ✅ checked
   - **Packages and scopes → Permissions**: Read and write
   - **Select packages**: All packages (tighten to `@agentmeter/cli` after first publish)
   - **Organizations**: No access
3. Copy the token

### 2. GitHub secret

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Name | Value |
|------|-------|
| `NPM_TOKEN` | the token from step 1 |

---

## How to cut a release

1. Merge all work to `main`
2. Go to **GitHub → Releases → Draft a new release**
3. Leave the tag field blank (or set an arbitrary label — the version is determined by the title, not the tag)
4. Write a release title using conventional commit style (see below)
5. Add release notes in the body (optional but recommended)
6. Click **Publish release**

The `publish.yml` workflow fires automatically and:
- Parses the release title to determine the bump type
- Runs `npm version <type> --no-git-tag-version` in `packages/cli/`
- Pushes a `chore: release @agentmeter/cli@x.y.z [skip ci]` commit back to `main`
- Builds and publishes to npm

---

## Conventional commit titles → semver bump

The release title is parsed left-to-right for these patterns:

| Title pattern | Bump | Example |
|---|---|---|
| `feat!: …` or any type with `!:` | **major** | `feat!: rename all CLI flags` |
| Body/title contains `BREAKING CHANGE` | **major** | `feat: new API\n\nBREAKING CHANGE: drops Node 18` |
| `feat: …` or `feat(scope): …` | **minor** | `feat(scanner): add Codex support` |
| `fix: …` | **patch** | `fix: handle missing config file` |
| `chore: …` | **patch** | `chore: update dependencies` |
| `docs: …` | **patch** | `docs: improve README` |
| `refactor: …` | **patch** | `refactor: simplify sync loop` |
| `perf: …` | **patch** | `perf: reduce API call overhead` |
| anything else | **patch** | fallback |

### Semver recap

| Bump | When to use |
|------|-------------|
| **patch** `0.1.0 → 0.1.1` | Bug fixes, internal changes, docs — nothing the consumer needs to act on |
| **minor** `0.1.0 → 0.2.0` | New features that are backwards-compatible |
| **major** `0.1.0 → 1.0.0` | Breaking changes — removed commands, renamed flags, changed config format |

---

## First publish note

`--access public` is required the first time you publish a scoped package (`@agentmeter/cli`) to mark it as public. The workflow always passes this flag; it's a no-op on subsequent publishes.

---

## Branch protection caveat

If `main` has branch protection rules that require PRs, the bot commit that bumps `package.json` will be rejected. Options:

- **Easiest**: exempt `github-actions[bot]` from the protection rule
- **Alternative**: replace `secrets.GITHUB_TOKEN` in the workflow with a PAT that has bypass permissions
- **Skip the commit-back entirely**: remove the "Commit and push version bump" step — the npm publish will still work; `package.json` in the repo just won't reflect the bumped version until your next manual commit

---

## README on npm

npm always includes `README.md` from the package root regardless of the `files` field in `package.json`. The file at `packages/cli/README.md` is the package root for `@agentmeter/cli`, so it will always appear on the npm package page automatically.
