import { ApiSuccessResponseSchema, ValidateKeyResponseSchema } from '../schemas/api-response.js';
import type { Config } from '../schemas/config.js';
import type { LocalSession } from '../schemas/session.js';
import { withRetry } from '../utils/retry.js';
import { logger } from './logger.js';

/**
 * Outcome of submitting a single session to POST /api/ingest/local
 */
export interface SubmitResult {
  /** Cost in cents returned by the API, or null if not yet calculated */
  costCents: number | null;

  /** Error message when status is 'error' */
  error?: string;

  /** The session ID that was submitted */
  sessionId: string;

  /** Whether the session was newly created, updated, a duplicate, or failed */
  status: 'created' | 'updated' | 'duplicate' | 'error';
}

/**
 * Outcome of sending a heartbeat ping to POST /api/ping
 */
export interface PingResult {
  /** Whether the ping was accepted */
  ok: boolean;
  /** ISO string of when the ping was recorded, or null on failure */
  pingedAt: string | null;
}

/**
 * Outcome of validating an API key against GET /api/auth/me
 */
export interface ValidateKeyResult {
  /** Whether the key is scoped to a personal user or an org, or null if unknown */
  keyType: 'personal' | 'org' | null;

  /** Organization name associated with the key, or null */
  orgName: string | null;

  /** User display name associated with the key, or null */
  userName: string | null;

  /** Whether the key was accepted by the API */
  valid: boolean;
}

/**
 * HTTP client for the AgentMeter API
 */
export class ApiClient {
  constructor(private readonly config: Config) {}

  /**
   * Sends a heartbeat to POST /api/ping so the contributor shows as "Connected"
   * in the Contributors dashboard. Fire-and-forget — failures are logged but
   * do not interrupt the sync loop. Only succeeds with personal API keys.
   */
  async sendPing(): Promise<PingResult> {
    try {
      const response = await fetch(`${this.config.apiUrl}/api/ping`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.info(`Ping returned ${response.status} — skipping`);
        return { ok: false, pingedAt: null };
      }

      const data = (await response.json()) as { ok?: boolean; pingedAt?: string };
      return { ok: data.ok === true, pingedAt: data.pingedAt ?? null };
    } catch {
      logger.info('Ping failed (network error) — skipping');
      return { ok: false, pingedAt: null };
    }
  }

  /**
   * Validates the configured API key against GET /api/auth/me.
   * Returns { valid: false } on any network or auth failure.
   */
  async validateKey(): Promise<ValidateKeyResult> {
    let response: Response;
    try {
      response = await fetch(`${this.config.apiUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    } catch {
      return { keyType: null, orgName: null, userName: null, valid: false };
    }

    if (response.status === 401) {
      return { keyType: null, orgName: null, userName: null, valid: false };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { keyType: null, orgName: null, userName: null, valid: false };
    }

    const result = ValidateKeyResponseSchema.safeParse(data);
    if (!result.success) {
      return { keyType: null, orgName: null, userName: null, valid: false };
    }

    return {
      keyType: result.data.keyType ?? null,
      orgName: result.data.orgName ?? null,
      userName: result.data.userName ?? null,
      valid: result.data.valid,
    };
  }

  /**
   * Submits a local session to POST /api/ingest/local with retry on 429.
   * Throws on 401 (invalid key). Returns a SubmitResult for all other outcomes.
   * Pass apiKeyOverride to use a per-project key instead of the global config key
   * (e.g. from .agentmeter.json in the project directory).
   */
  async submitSession(session: LocalSession, apiKeyOverride?: string): Promise<SubmitResult> {
    const t = session.tokens;
    const apiKey = apiKeyOverride ?? this.config.apiKey;
    const body = {
      sessionId: session.sessionId,
      repoFullName: session.repoFullName,
      deviceName: this.config.deviceName,
      engine: session.engine,
      model: session.model,
      status: session.status,
      title: session.title,
      startedAt: session.startTime,
      completedAt: session.endTime ?? null,
      durationSeconds: session.durationSeconds,
      turns: session.turns,
      tokens: {
        inputTokens: t.input,
        outputTokens: t.output,
        cacheReadTokens: t.cacheRead,
        cacheWriteTokens: t.cacheWrite,
        isApproximate: t.isApproximate ?? false,
      },
    };

    const makeRequest = async (): Promise<Response> => {
      const response = await fetch(`${this.config.apiUrl}/api/ingest/local`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // Throw on 429 so retry logic kicks in
      if (response.status === 429) {
        throw new Error('Rate limited (429)');
      }

      return response;
    };

    let response: Response;
    try {
      response = await withRetry(makeRequest, { maxAttempts: 3 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      logger.error(`Failed to submit session ${session.sessionId}: ${message}`);
      return { costCents: null, error: message, sessionId: session.sessionId, status: 'error' };
    }

    if (response.status === 401) {
      throw new Error('Invalid API key — aborting sync');
    }

    if (response.status === 409) {
      return { costCents: null, sessionId: session.sessionId, status: 'duplicate' };
    }

    if (response.status === 404) {
      logger.error(`Session ${session.sessionId} rejected: repo not found on server`);
      return {
        costCents: null,
        error: 'Repo not found',
        sessionId: session.sessionId,
        status: 'error',
      };
    }

    if (response.status === 400 || response.status === 422) {
      let errorMsg = 'Validation error';
      try {
        const data: unknown = await response.json();
        if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          const msg = d.error ?? d.message;
          if (typeof msg === 'string') errorMsg = msg;
        }
      } catch {
        // Ignore parse error, use default message
      }
      logger.error(`Session ${session.sessionId} rejected: ${errorMsg}`);
      return { costCents: null, error: errorMsg, sessionId: session.sessionId, status: 'error' };
    }

    if (response.status >= 500) {
      const message = `Server error: ${response.status}`;
      logger.error(`Failed to submit session ${session.sessionId}: ${message}`);
      return { costCents: null, error: message, sessionId: session.sessionId, status: 'error' };
    }

    let costCents: number | null = null;
    try {
      const data: unknown = await response.json();
      const result = ApiSuccessResponseSchema.safeParse(data);
      if (result.success) {
        costCents = result.data.costCents ?? null;
      }
    } catch {
      // Response body is optional
    }

    return {
      costCents,
      sessionId: session.sessionId,
      status: response.status === 201 ? 'created' : 'updated',
    };
  }
}
