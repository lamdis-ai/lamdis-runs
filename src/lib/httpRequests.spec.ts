import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveAuthHeaderFromBlock } from './httpRequests.js';

// Mock cross-fetch
vi.mock('cross-fetch', () => ({
  default: vi.fn(),
}));

describe('httpRequests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveAuthHeaderFromBlock', () => {
    it('returns undefined for null auth', async () => {
      const result = await resolveAuthHeaderFromBlock(null, {});
      expect(result).toBeUndefined();
    });

    it('returns undefined for non-object auth', async () => {
      const result = await resolveAuthHeaderFromBlock('string', {});
      expect(result).toBeUndefined();
    });

    it('returns undefined for unknown kind', async () => {
      const result = await resolveAuthHeaderFromBlock({ kind: 'unknown' }, {});
      expect(result).toBeUndefined();
    });

    it('extracts authorization from headers block', async () => {
      const auth = {
        headers: {
          authorization: 'Bearer my-token',
        },
      };
      const result = await resolveAuthHeaderFromBlock(auth, {});
      expect(result).toBe('Bearer my-token');
    });

    it('extracts Authorization (capitalized) from headers block', async () => {
      const auth = {
        headers: {
          Authorization: 'Bearer my-capitalized-token',
        },
      };
      const result = await resolveAuthHeaderFromBlock(auth, {});
      expect(result).toBe('Bearer my-capitalized-token');
    });

    it('interpolates variables in headers', async () => {
      const auth = {
        headers: {
          authorization: 'Bearer ${env.API_TOKEN}',
        },
      };
      const rootVars = { env: { API_TOKEN: 'interpolated-token' } };
      const result = await resolveAuthHeaderFromBlock(auth, rootVars);
      expect(result).toBe('Bearer interpolated-token');
    });

    it('returns undefined if authorization header not a string', async () => {
      const auth = {
        headers: {
          authorization: { nested: 'object' },
        },
      };
      const result = await resolveAuthHeaderFromBlock(auth, {});
      expect(result).toBeUndefined();
    });

    describe('oauth_client_credentials', () => {
      it('returns undefined if clientId is missing', async () => {
        const auth = {
          kind: 'oauth_client_credentials',
          clientSecret: 'secret',
          tokenUrl: 'https://example.com/token',
        };
        const result = await resolveAuthHeaderFromBlock(auth, {});
        expect(result).toBeUndefined();
      });

      it('returns undefined if clientSecret is missing', async () => {
        const auth = {
          kind: 'oauth_client_credentials',
          clientId: 'id',
          tokenUrl: 'https://example.com/token',
        };
        const result = await resolveAuthHeaderFromBlock(auth, {});
        expect(result).toBeUndefined();
      });

      it('returns undefined if tokenUrl is missing', async () => {
        const auth = {
          kind: 'oauth_client_credentials',
          clientId: 'id',
          clientSecret: 'secret',
        };
        const result = await resolveAuthHeaderFromBlock(auth, {});
        expect(result).toBeUndefined();
      });

      it('fetches token from OAuth endpoint', async () => {
        const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
        fetch.mockResolvedValueOnce({
          json: () => Promise.resolve({ access_token: 'oauth-token', expires_in: 3600 }),
        });

        const auth = {
          kind: 'oauth_client_credentials',
          clientId: 'my-client-id',
          clientSecret: 'my-client-secret',
          tokenUrl: 'https://auth.example.com/token',
        };

        const result = await resolveAuthHeaderFromBlock(auth, {});
        
        expect(fetch).toHaveBeenCalledWith(
          'https://auth.example.com/token',
          expect.objectContaining({
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
          })
        );
        expect(result).toBe('Bearer oauth-token');
      });

      it('includes scopes in token request', async () => {
        const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
        fetch.mockResolvedValueOnce({
          json: () => Promise.resolve({ access_token: 'scoped-token' }),
        });

        const auth = {
          kind: 'oauth_client_credentials',
          clientId: 'client',
          clientSecret: 'secret',
          tokenUrl: 'https://auth.example.com/token',
          scopes: ['read', 'write'],
        };

        await resolveAuthHeaderFromBlock(auth, {});
        
        const callBody = fetch.mock.calls[0][1].body;
        expect(callBody).toContain('scope=read+write');
      });

      it('uses cached token if not expired', async () => {
        const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
        fetch.mockResolvedValue({
          json: () => Promise.resolve({ access_token: 'cached-token', expires_in: 3600 }),
        });

        const auth = {
          kind: 'oauth_client_credentials',
          clientId: 'cached-client',
          clientSecret: 'secret',
          tokenUrl: 'https://auth.example.com/token',
        };

        // First call - fetches token
        const result1 = await resolveAuthHeaderFromBlock(auth, {});
        expect(result1).toBe('Bearer cached-token');

        // Second call - should use cache
        const result2 = await resolveAuthHeaderFromBlock(auth, {});
        expect(result2).toBe('Bearer cached-token');

        // fetch should only have been called once
        expect(fetch).toHaveBeenCalledTimes(1);
      });

      it('returns undefined and logs when token fetch fails', async () => {
        const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
        fetch.mockRejectedValueOnce(new Error('Network error'));

        const auth = {
          kind: 'oauth_client_credentials',
          clientId: 'failing-client',
          clientSecret: 'secret',
          tokenUrl: 'https://auth.example.com/token',
        };

        const logEntries: any[] = [];
        const log = (e: any) => logEntries.push(e);

        const result = await resolveAuthHeaderFromBlock(auth, {}, log);
        
        expect(result).toBeUndefined();
        expect(logEntries).toHaveLength(1);
        expect(logEntries[0].type).toBe('auth_error');
      });

      it('returns undefined when access_token is empty', async () => {
        const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
        fetch.mockResolvedValueOnce({
          json: () => Promise.resolve({ access_token: '' }),
          status: 200,
        });

        const auth = {
          kind: 'oauth_client_credentials',
          clientId: 'empty-token-client',
          clientSecret: 'secret',
          tokenUrl: 'https://auth.example.com/token',
        };

        const logEntries: any[] = [];
        const result = await resolveAuthHeaderFromBlock(auth, {}, (e) => logEntries.push(e));
        
        expect(result).toBeUndefined();
        expect(logEntries[0].type).toBe('auth_error');
      });

      it('interpolates clientId and clientSecret from vars', async () => {
        const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
        fetch.mockResolvedValueOnce({
          json: () => Promise.resolve({ access_token: 'env-token' }),
        });

        const auth = {
          kind: 'oauth_client_credentials',
          clientId: '${env.CLIENT_ID}',
          clientSecret: '${env.CLIENT_SECRET}',
          tokenUrl: 'https://auth.example.com/token',
        };

        const rootVars = {
          env: { CLIENT_ID: 'from-env-id', CLIENT_SECRET: 'from-env-secret' },
        };

        await resolveAuthHeaderFromBlock(auth, rootVars);
        
        const callBody = fetch.mock.calls[0][1].body;
        expect(callBody).toContain('client_id=from-env-id');
        expect(callBody).toContain('client_secret=from-env-secret');
      });
    });
  });

  describe('executeRequest', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('throws error when request not found', async () => {
      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false, getRequest: vi.fn() },
      }));
      vi.doMock('../models/Request.js', () => ({
        RequestModel: { findOne: () => ({ lean: () => Promise.resolve(null) }) },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      await expect(executeRequest('org-1', 'missing-request', {}))
        .rejects.toThrow('request_not_found: missing-request');
    });

    it('throws error when URL is missing', async () => {
      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));
      vi.doMock('../models/Request.js', () => ({
        RequestModel: {
          findOne: () => ({
            lean: () => Promise.resolve({ id: 'test-req', transport: { http: {} } }),
          }),
        },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      await expect(executeRequest('org-1', 'test-req', {}))
        .rejects.toThrow('request_url_missing');
    });

    it('uses fileRequests when provided', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ success: true }),
        status: 200,
      });

      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      const fileRequests = {
        'my-request': {
          transport: {
            http: {
              method: 'GET',
              full_url: 'https://api.example.com/data',
            },
          },
        },
      };

      const result = await executeRequest('org-1', 'my-request', {}, undefined, undefined, fileRequests);

      expect(result.status).toBe(200);
      expect(result.payload).toEqual({ success: true });
      expect(result.kind).toBe('data');
    });

    it('makes GET request with query params', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ id: 123 }),
        status: 200,
      });

      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      const fileRequests = {
        'get-user': {
          transport: {
            http: { method: 'GET', full_url: 'https://api.example.com/users' },
          },
        },
      };

      await executeRequest('org-1', 'get-user', { id: '123' }, undefined, undefined, fileRequests);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('id=123'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('makes POST request with JSON body', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ created: true }),
        status: 201,
      });

      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      const fileRequests = {
        'create-user': {
          transport: {
            http: { method: 'POST', full_url: 'https://api.example.com/users' },
          },
        },
      };

      const result = await executeRequest(
        'org-1', 'create-user', { name: 'Test' }, undefined, undefined, fileRequests
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test' }),
        })
      );
      expect(result.status).toBe(201);
    });

    it('includes auth header when provided', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
        status: 200,
      });

      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      const fileRequests = {
        'authed-req': {
          transport: { http: { method: 'GET', full_url: 'https://api.example.com/secure' } },
        },
      };

      await executeRequest('org-1', 'authed-req', {}, 'Bearer my-token', undefined, fileRequests);

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
        })
      );
    });

    it('handles text response', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        headers: { get: () => 'text/plain' },
        text: () => Promise.resolve('Hello World'),
        status: 200,
      });

      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      const fileRequests = {
        'text-req': {
          transport: { http: { method: 'GET', full_url: 'https://api.example.com/text' } },
        },
      };

      const result = await executeRequest('org-1', 'text-req', {}, undefined, undefined, fileRequests);

      expect(result.kind).toBe('text');
      expect(result.payload).toBe('Hello World');
    });

    it('interpolates URL template variables', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
        status: 200,
      });

      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      const fileRequests = {
        'templated-req': {
          transport: { http: { method: 'GET', full_url: 'https://api.example.com/users/{userId}' } },
        },
      };

      await executeRequest('org-1', 'templated-req', { userId: '456' }, undefined, undefined, fileRequests);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/users/456'),
        expect.any(Object)
      );
    });

    it('calls log function for request and result', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
        status: 200,
      });

      vi.doMock('../db/repo.js', () => ({
        repo: { isPg: () => false },
      }));

      const { executeRequest } = await import('./httpRequests.js');

      const fileRequests = {
        'logged-req': {
          transport: { http: { method: 'GET', full_url: 'https://api.example.com/log' } },
        },
      };

      const logEntries: any[] = [];
      await executeRequest('org-1', 'logged-req', {}, undefined, (e) => logEntries.push(e), fileRequests);

      expect(logEntries).toHaveLength(2);
      expect(logEntries[0].type).toBe('request_exec');
      expect(logEntries[1].type).toBe('request_result');
    });
  });
});
