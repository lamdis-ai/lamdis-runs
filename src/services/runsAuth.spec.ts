import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import crypto from 'crypto';
import { registerRunsAuth } from './runsAuth.js';

describe('runsAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('registerRunsAuth', () => {
    it('allows requests without auth when API_TOKEN not set', async () => {
      delete process.env.LAMDIS_API_TOKEN;
      
      const app = Fastify();
      registerRunsAuth(app);
      
      app.get('/internal/runs/test', async () => ({ ok: true }));
      
      const response = await app.inject({
        method: 'GET',
        url: '/internal/runs/test',
      });
      
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('allows requests with matching x-api-token header', async () => {
      process.env.LAMDIS_API_TOKEN = 'test-token-123';
      
      const app = Fastify();
      registerRunsAuth(app);
      
      app.get('/internal/runs/test', async () => ({ ok: true }));
      
      const response = await app.inject({
        method: 'GET',
        url: '/internal/runs/test',
        headers: { 'x-api-token': 'test-token-123' },
      });
      
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('allows requests with matching x-lamdis-api-token header', async () => {
      process.env.LAMDIS_API_TOKEN = 'test-token-456';
      
      const app = Fastify();
      registerRunsAuth(app);
      
      app.get('/internal/runs/test', async () => ({ ok: true }));
      
      const response = await app.inject({
        method: 'GET',
        url: '/internal/runs/test',
        headers: { 'x-lamdis-api-token': 'test-token-456' },
      });
      
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('allows requests with Bearer token in authorization header', async () => {
      process.env.LAMDIS_API_TOKEN = 'bearer-token';
      
      const app = Fastify();
      registerRunsAuth(app);
      
      app.get('/internal/runs/test', async () => ({ ok: true }));
      
      const response = await app.inject({
        method: 'GET',
        url: '/internal/runs/test',
        headers: { 'authorization': 'Bearer bearer-token' },
      });
      
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('rejects requests with wrong token', async () => {
      process.env.LAMDIS_API_TOKEN = 'correct-token';
      
      const app = Fastify();
      registerRunsAuth(app);
      
      app.get('/internal/runs/test', async () => ({ ok: true }));
      
      const response = await app.inject({
        method: 'GET',
        url: '/internal/runs/test',
        headers: { 'x-api-token': 'wrong-token' },
      });
      
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
      await app.close();
    });

    it('allows non-internal routes without auth', async () => {
      process.env.LAMDIS_API_TOKEN = 'required-token';
      
      const app = Fastify();
      registerRunsAuth(app);
      
      app.get('/other/route', async () => ({ ok: true }));
      
      const response = await app.inject({
        method: 'GET',
        url: '/other/route',
      });
      
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    describe('HMAC signature verification', () => {
      it('validates correct HMAC signature', async () => {
        process.env.LAMDIS_API_TOKEN = 'api-token';
        process.env.LAMDIS_HMAC_SECRET = 'hmac-secret-key';
        
        const app = Fastify();
        registerRunsAuth(app);
        
        app.post('/internal/runs/test', async () => ({ ok: true }));
        
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const body = JSON.stringify({ data: 'test' });
        const signature = crypto
          .createHmac('sha256', 'hmac-secret-key')
          .update(`${timestamp}.${body}`)
          .digest('hex');
        
        const response = await app.inject({
          method: 'POST',
          url: '/internal/runs/test',
          headers: {
            'x-api-token': 'api-token',
            'x-timestamp': timestamp,
            'x-signature': signature,
            'content-type': 'application/json',
          },
          payload: body,
        });
        
        expect(response.statusCode).toBe(200);
        await app.close();
      });

      it('rejects stale timestamp (>300s old)', async () => {
        process.env.LAMDIS_API_TOKEN = 'api-token';
        process.env.LAMDIS_HMAC_SECRET = 'hmac-secret';
        
        const app = Fastify();
        registerRunsAuth(app);
        
        app.post('/internal/runs/test', async () => ({ ok: true }));
        
        const staleTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
        const body = JSON.stringify({});
        const signature = crypto
          .createHmac('sha256', 'hmac-secret')
          .update(`${staleTimestamp}.${body}`)
          .digest('hex');
        
        const response = await app.inject({
          method: 'POST',
          url: '/internal/runs/test',
          headers: {
            'x-api-token': 'api-token',
            'x-timestamp': staleTimestamp,
            'x-signature': signature,
            'content-type': 'application/json',
          },
          payload: body,
        });
        
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'stale_request' });
        await app.close();
      });

      it('rejects invalid signature', async () => {
        process.env.LAMDIS_API_TOKEN = 'api-token';
        process.env.LAMDIS_HMAC_SECRET = 'hmac-secret';
        
        const app = Fastify();
        registerRunsAuth(app);
        
        app.post('/internal/runs/test', async () => ({ ok: true }));
        
        const timestamp = Math.floor(Date.now() / 1000).toString();
        
        const response = await app.inject({
          method: 'POST',
          url: '/internal/runs/test',
          headers: {
            'x-api-token': 'api-token',
            'x-timestamp': timestamp,
            'x-signature': 'invalid-signature',
            'content-type': 'application/json',
          },
          payload: JSON.stringify({}),
        });
        
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'bad_signature' });
        await app.close();
      });

      it('skips HMAC check when secret not set', async () => {
        process.env.LAMDIS_API_TOKEN = 'api-token';
        delete process.env.LAMDIS_HMAC_SECRET;
        
        const app = Fastify();
        registerRunsAuth(app);
        
        app.post('/internal/runs/test', async () => ({ ok: true }));
        
        const response = await app.inject({
          method: 'POST',
          url: '/internal/runs/test',
          headers: {
            'x-api-token': 'api-token',
            'x-timestamp': 'some-ts',
            'x-signature': 'some-sig',
            'content-type': 'application/json',
          },
          payload: JSON.stringify({}),
        });
        
        expect(response.statusCode).toBe(200);
        await app.close();
      });
    });
  });
});
