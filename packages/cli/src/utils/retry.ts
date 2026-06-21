/**
 * Configuration for exponential-backoff retry behavior
 */
export interface RetryOptions {
  /** Initial delay in milliseconds before the first retry */
  baseDelayMs: number;

  /** Maximum number of attempts before throwing the last error */
  maxAttempts: number;

  /** Upper bound on the computed delay between retries */
  maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  baseDelayMs: 1000,
  maxAttempts: 3,
  maxDelayMs: 30_000,
};

/**
 * Retries an async function with exponential backoff on failure
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) {
        const delay = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
