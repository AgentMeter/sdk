import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const AgentMeterProjectConfigSchema = z
  .object({
    repoFullName: z.string().optional(),
    repo: z.string().optional(),
  })
  .passthrough();

/**
 * Walks up from dir looking for .agentmeter.json with a repoFullName or repo field
 */
function findProjectConfig(dir: string): string | null {
  let current = dir;
  while (true) {
    try {
      const raw = fs.readFileSync(path.join(current, '.agentmeter.json'), 'utf8');
      const result = AgentMeterProjectConfigSchema.safeParse(JSON.parse(raw));
      if (result.success) {
        const value = result.data.repoFullName ?? result.data.repo;
        if (value) return value;
      }
    } catch {
      // Not found at this level — keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Parses a git remote URL into owner/repo format.
 * Handles SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git).
 */
function parseGitRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  const sshMatch = trimmed.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];
  const httpsMatch = trimmed.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) return httpsMatch[1];
  return null;
}

/**
 * Resolves the repo full name (e.g. "owner/repo") for a project directory.
 * Priority: .agentmeter.json config > git remote origin > directory basename.
 */
export function resolveRepoFullName(dir: string): string {
  const fromConfig = findProjectConfig(dir);
  if (fromConfig) return fromConfig;

  try {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 3000,
    });
    if (result.status === 0 && result.stdout) {
      const parsed = parseGitRemoteUrl(result.stdout);
      if (parsed) return parsed;
    }
  } catch {
    // git unavailable or not a git repo
  }

  return path.basename(dir);
}
