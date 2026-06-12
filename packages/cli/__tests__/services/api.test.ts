import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSession } from '../../src/schemas/session.js';
import { ApiClient } from '../../src/services/api.js';

vi.mock('../../src/services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockConfig = {
  apiKey: 'am_sk_test123',
  deviceName: 'test-device',
  apiUrl: 'https://agentmeter.app',
};

const mockSession: LocalSession = {
  sessionId: 'sess_abc123',
  repoFullName: 'adamhenson/myproject',
  engine: 'claude',
  model: 'claude-sonnet-4-5',
  status: 'success',
  title: 'Implement login page',
  startTime: '2026-06-08T14:00:00.000Z',
  endTime: '2026-06-08T14:03:42.000Z',
  durationSeconds: 222,
  tokens: { input: 45000, output: 8200, cacheRead: 12000, cacheWrite: 3000 },
};

describe('ApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('validateKey', () => {
    it('returns valid result on 200 with valid data', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: async () => ({
            valid: true,
            orgName: 'acme-corp',
            userName: 'adamhenson',
            keyType: 'personal',
          }),
        }),
      );

      const client = new ApiClient(mockConfig);
      const result = await client.validateKey();

      expect(result.valid).toBe(true);
      expect(result.orgName).toBe('acme-corp');
      expect(result.userName).toBe('adamhenson');
      expect(result.keyType).toBe('personal');
    });

    it('returns invalid on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) }));

      const client = new ApiClient(mockConfig);
      const result = await client.validateKey();

      expect(result.valid).toBe(false);
      expect(result.orgName).toBeNull();
    });

    it('returns invalid when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const client = new ApiClient(mockConfig);
      const result = await client.validateKey();

      expect(result.valid).toBe(false);
    });
  });

  describe('submitSession', () => {
    it('returns created on 201', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 201,
          json: async () => ({ sessionId: 'sess_abc123', costCents: 122 }),
        }),
      );

      const client = new ApiClient(mockConfig);
      const result = await client.submitSession(mockSession);

      expect(result.status).toBe('created');
      expect(result.costCents).toBe(122);
      expect(result.sessionId).toBe('sess_abc123');
    });

    it('returns updated on 200', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: async () => ({ sessionId: 'sess_abc123', costCents: 87 }),
        }),
      );

      const client = new ApiClient(mockConfig);
      const result = await client.submitSession(mockSession);

      expect(result.status).toBe('updated');
    });

    it('returns duplicate on 409', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 409, json: async () => ({}) }));

      const client = new ApiClient(mockConfig);
      const result = await client.submitSession(mockSession);

      expect(result.status).toBe('duplicate');
    });

    it('throws on 401 (abort sync)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) }));

      const client = new ApiClient(mockConfig);
      await expect(client.submitSession(mockSession)).rejects.toThrow('Invalid API key');
    });

    it('returns error on 400 with message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 400,
          json: async () => ({ error: 'Missing required field: sessionId' }),
        }),
      );

      const client = new ApiClient(mockConfig);
      const result = await client.submitSession(mockSession);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Missing required field: sessionId');
    });

    it('returns error on network failure (after retries)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const client = new ApiClient(mockConfig);
      const result = await client.submitSession(mockSession);

      expect(result.status).toBe('error');
    });

    it('includes correct Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 201,
        json: async () => ({ sessionId: 'sess_abc123', costCents: 100 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new ApiClient(mockConfig);
      await client.submitSession(mockSession);

      const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer am_sk_test123');
    });
  });
});
