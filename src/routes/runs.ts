import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { judgeBodySchema, judgeConversation } from '../services/judgeService.js';
import { registerRunsAuth } from '../services/runsAuth.js';
import { runFileBodySchema, runTestFile } from '../services/testExecution/fileRunner.js';
import { jsonSuitesBodySchema, runJsonSuites } from '../services/testExecution/jsonSuitesRunner.js';
import { startDbBackedRun } from '../services/testExecution/dbRunStarter.js';

export default async function runsRoutes(app: FastifyInstance) {
  // Local judge endpoint (OpenAI/Bedrock-backed) — delegated to judgeService
  app.post('/orgs/:orgId/judge', async (req) => {
    const body = judgeBodySchema.parse(req.body as any);
    return judgeConversation(body);
  });

  registerRunsAuth(app);

  // DB-backed (hosted) run starter
  app.post('/internal/runs/start', async (req) => {
    const body = z.object({
      trigger: z.enum(['manual', 'schedule', 'ci']).default('ci'),
      gitContext: z.any().optional(),
      authHeader: z.string().optional(),
      webhookUrl: z.string().url().optional(),
      mode: z.enum(['mongo', 'json']).optional(),
      suiteId: z.string(),
      envId: z.string().optional(),
      connKey: z.string().optional(),
      tests: z.array(z.string()).optional(),
    }).parse(req.body as any);

    return startDbBackedRun(body as any);
  });

  // Run a JSON test file directly without persisting suite/tests.
  app.post('/internal/run-file', async (req, reply) => {
    const body = runFileBodySchema.parse(req.body as any);
    const { statusCode, payload } = await runTestFile(body);
    return reply.code(statusCode).send(payload as any);
  });

  // Run one or more JSON suites from disk (JSON-only runner mode)
  app.post('/internal/run-json-suites', async (req, reply) => {
    const body = jsonSuitesBodySchema.parse(req.body as any);
    const { statusCode, payload } = await runJsonSuites(body);
    return reply.code(statusCode).send(payload as any);
  });
}