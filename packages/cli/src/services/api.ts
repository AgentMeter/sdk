import { ApiSuccessResponseSchema, ValidateKeyResponseSchema } from '../schemas/api-response.js';
import type { Config } from '../schemas/config.js';
import type { LocalSession } from '../schemas/session.js';
import { withRetry } from '../utils/retry.js';
import { logger } from './logger.js';

export interface SubmitResult {
  sessionId: string;
  costCents: number | null;
  status: 'created' | 'updated' | 'duplicate' | 'error';
  error?: string;
}

export interface ValidateKeyResult {
  valid: boolean;
  orgName: string | null;
  userName: string | null;
  keyType: 'personal' | 'org' | null;
}

/**
 * HTTP client for the AgentMeter API
 */
export class ApiClient {
  constructor(private readonly config: Config) {}

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
      return { valid: false, orgName: null, userName: null, keyType: null };
    }

    if (response.status === 401) {
      return { valid: false, orgName: null, userName: null, keyType: null };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { valid: false, orgName: null, userName: null, keyType: null };
    }

    const result = ValidateKeyResponseSchema.safeParse(data);
    if (!result.success) {
      return { valid: false, orgName: null, userName: null, keyType: null };
    }

    return {
      valid: result.data.valid,
      orgName: result.data.orgName ?? null,
      userName: result.data.userName ?? null,
      keyType: result.data.keyType ?? null,
    };
  }

  /**
   * Submits a local session to POST /api/ingest/local with retry on 429.
   * Throws on 401 (invalid key). Returns a SubmitResult for all other outcomes.
   */
  async submitSession(session: LocalSession): Promise<SubmitResult> {
    const t = session.tokens;
    const body = {
      sessionId: session.sessionId,
      projectPath: session.projectPath,
      deviceName: this.config.deviceName,
      engine: session.engine,
      model: session.model,
      status: session.status,
      title: session.title,
      startedAt: session.startTime,
      completedAt: session.endTime ?? null,
      durationSeconds: session.durationSeconds,
      tokens: t
        ? {
            inputTokens: t.input,
            outputTokens: t.output,
            cacheReadTokens: t.cacheRead,
            cacheWriteTokens: t.cacheWrite,
            isApproximate: false,
          }
        : null,
    };

    const makeRequest = async (): Promise<Response> => {
      const response = await fetch(`${this.config.apiUrl}/api/ingest/local`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
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
      return { sessionId: session.sessionId, costCents: null, status: 'error', error: message };
    }

    if (response.status === 401) {
      throw new Error('Invalid API key — aborting sync');
    }

    if (response.status === 409) {
      return { sessionId: session.sessionId, costCents: null, status: 'duplicate' };
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
      return { sessionId: session.sessionId, costCents: null, status: 'error', error: errorMsg };
    }

    if (response.status >= 500) {
      const message = `Server error: ${response.status}`;
      logger.error(`Failed to submit session ${session.sessionId}: ${message}`);
      return { sessionId: session.sessionId, costCents: null, status: 'error', error: message };
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
      sessionId: session.sessionId,
      costCents,
      status: response.status === 201 ? 'created' : 'updated',
    };
  }
}
