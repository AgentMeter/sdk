import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const AgentMeterProjectConfigSchema = z
  .object({
    apiKey: z.string().optional(),
    repoFullName: z.string().optional(),
    repo: z.string().optional(),
  })
  .passthrough();

/**
 * Walks up from dir looking for .agentmeter.json and returns the parsed config,
 * or null if not found.
 */
function findRawProjectConfig(dir: string): z.infer<typeof AgentMeterProjectConfigSchema> | null {
  let current = dir;
  while (true) {
    try {
      const raw = fs.readFileSync(path.join(current, '.agentmeter.json'), 'utf8');
      const result = AgentMeterProjectConfigSchema.safeParse(JSON.parse(raw));
      if (result.success) return result.data;
    } catch {
      // Not found at this level — keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Walks up from dir looking for .agentmeter.json with a repoFullName or repo field
 */
function findProjectConfig(dir: string): string | null {
  const config = findRawProjectConfig(dir);
  return config?.repoFullName ?? config?.repo ?? null;
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
 * Resolves a per-project API key override from .agentmeter.json.
 * Returns null if no .agentmeter.json with an apiKey field is found.
 * Useful when different projects should be tracked under different AgentMeter accounts
 * (e.g. personal repos under a personal account, org repos under an org account).
 */
export function resolveProjectApiKey(dir: string): string | null {
  return findRawProjectConfig(dir)?.apiKey ?? null;
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
