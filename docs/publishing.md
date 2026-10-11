# Publishing @agentmeter/cli to npm

Releases are triggered by publishing a GitHub Release. The workflow automatically determines the semantic version bump from the release title, bumps `packages/cli/package.json`, and publishes to npm.

---

## One-time setup — trusted publishing

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/): GitHub Actions authenticates to npm with a short-lived OIDC credential, so there is **no `NPM_TOKEN` secret** to create, expire, or rotate, and every release gets a provenance attestation. (Granular tokens with bypass-2FA lose direct-publish access in January 2027.)

On [npmjs.com](https://www.npmjs.com/package/@agentmeter/cli) → **Settings** → **Trusted Publisher** → **GitHub Actions**:

| Field | Value |
|---|---|
| Organization or user | `AgentMeter` |
| Repository | `sdk` |
| Workflow filename | `publish.yml` |
| Environment | *(blank)* |
| Allowed actions | ✅ `npm publish` |

The workflow needs `id-token: write` (already set) and npm CLI 11.5.1+ (installed in the job). `packages/cli/package.json` `repository` must match this repo for provenance.

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
- Builds and publishes to npm
- Pushes a `chore: release @agentmeter/cli@x.y.z [skip ci]` commit back to `main`

### If the publish step fails

The bump commit is only pushed after a successful publish, so a failed publish leaves `main` untouched — fix the cause (usually the trusted publisher config on npmjs.com) and re-run the job. If `main` already has an unpublished version (e.g. from an older workflow), publish it without bumping:

```bash
gh workflow run publish.yml --ref main
```

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
