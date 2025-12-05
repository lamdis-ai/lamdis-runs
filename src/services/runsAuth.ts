import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';

export function registerRunsAuth(app: FastifyInstance): void {
  const API_TOKEN = process.env.LAMDIS_API_TOKEN || '';

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith('/internal/runs')) {
      const token = (req.headers['x-api-token']
        || req.headers['x-lamdis-api-token']
        || req.headers['authorization']) as string | undefined;

      if (API_TOKEN && token !== API_TOKEN && token !== `Bearer ${API_TOKEN}`) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const sig = (req.headers['x-signature'] as string) || '';
      const ts = (req.headers['x-timestamp'] as string) || '';
      const secret = process.env.LAMDIS_HMAC_SECRET || '';

      if (secret && sig && ts) {
        const now = Math.floor(Date.now() / 1000);
        const tsv = Number(ts);
        if (!tsv || Math.abs(now - tsv) > 300) {
          return reply.code(401).send({ error: 'stale_request' });
        }
        try {
          const raw = JSON.stringify(req.body ?? {});
          const expect = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
          const ok = (() => {
            try {
              return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig));
            } catch {
              return false;
            }
          })();
          if (!ok) return reply.code(401).send({ error: 'bad_signature' });
        } catch {
          return reply.code(401).send({ error: 'bad_signature' });
        }
      }
    }
  });
}
