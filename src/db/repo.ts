// Database-agnostic repository: supports Mongo (default) and Postgres (via Prisma) at runtime.
// Postgres is enabled when DB_PROVIDER=postgres or DATABASE_URL starts with postgres.

import { TestSuiteModel } from '../models/TestSuite.js';
import { TestModel } from '../models/Test.js';
import { EnvironmentModel } from '../models/Environment.js';
import { OrganizationModel } from '../models/Organization.js';
import { PersonaModel } from '../models/Persona.js';
import { RequestModel } from '../models/Request.js';
import { TestRunModel } from '../models/TestRun.js';
import { UsageModel } from '../models/Usage.js';

const isPg = () => String(process.env.DB_PROVIDER || '').toLowerCase() === 'postgres'
  || String(process.env.DATABASE_URL || '').toLowerCase().startsWith('postgres');

let prisma: any | undefined;
async function getPrisma() {
  if (!prisma) {
    const mod = await import('@prisma/client').catch(() => ({} as any));
    const Client = (mod as any)?.PrismaClient;
    if (!Client) throw new Error('postgres_not_enabled: install @prisma/client and run prisma generate');
    prisma = new Client();
  }
  return prisma;
}

export const repo = {
  isPg,
  async getSuiteById(id: string) {
    if (isPg()) {
      const p = await (await getPrisma()).testSuite.findUnique({ where: { id } });
      return p;
    }
    return await (TestSuiteModel as any).findById(id).lean();
  },
  async getTests(filter: { orgId: string; suiteId: string; ids?: string[] }) {
    if (isPg()) {
      const where: any = { orgId: filter.orgId, suiteId: filter.suiteId };
      if (filter.ids?.length) where.id = { in: filter.ids };
      return await (await getPrisma()).test.findMany({ where });
    }
    const q: any = { orgId: filter.orgId, suiteId: filter.suiteId };
    if (filter.ids?.length) q._id = { $in: filter.ids };
    return await (TestModel as any).find(q).lean();
  },
  async getEnvironment(orgId: string, suiteId: string, envId: string) {
    if (isPg()) {
      return await (await getPrisma()).environment.findFirst({ where: { id: envId, orgId, suiteId } });
    }
    return await (EnvironmentModel as any).findOne({ _id: envId, orgId, suiteId }).lean();
  },
  async getOrganizationById(id: string) {
    if (isPg()) {
      return await (await getPrisma()).organization.findUnique({ where: { id } });
    }
    return await (OrganizationModel as any).findById(id).lean();
  },
  async getPersona(orgId: string, personaId: string) {
    if (isPg()) {
      return await (await getPrisma()).persona.findFirst({ where: { id: personaId, orgId } });
    }
    return await (PersonaModel as any).findOne({ _id: personaId, orgId }).lean();
  },
  async getRequest(orgId: string, reqKey: string) {
    if (isPg()) {
      return await (await getPrisma()).request.findFirst({ where: { orgId, reqKey } });
    }
    return await (RequestModel as any).findOne({ orgId, id: reqKey }).lean();
  },
  async createTestRun(doc: any) {
    if (isPg()) {
      const created = await (await getPrisma()).testRun.create({ data: {
        orgId: String(doc.orgId), suiteId: String(doc.suiteId), envId: doc.envId || null,
        connectionKey: doc.connectionKey || null, trigger: String(doc.trigger||'ci'), status: String(doc.status||'queued'),
        startedAt: doc.startedAt || null, finishedAt: doc.finishedAt || null
      }});
      return created;
    }
    return await (TestRunModel as any).create(doc);
  },
  async updateTestRun(runId: string, set: any) {
    if (isPg()) {
      return await (await getPrisma()).testRun.update({ where: { id: runId }, data: mapSet(set) });
    }
    return await (TestRunModel as any).updateOne({ _id: runId }, { $set: set });
  },
  async getTestRunById(runId: string) {
    if (isPg()) {
      return await (await getPrisma()).testRun.findUnique({ where: { id: runId } });
    }
    return await (TestRunModel as any).findById(runId).lean();
  },
  async createOrUpdateUsage(runId: string, payload: any) {
    if (isPg()) {
      const p = await getPrisma();
      try {
        await p.usage.create({ data: { runId, ...payload } });
      } catch {
        await p.usage.update({ where: { runId }, data: mapSet(payload) });
      }
      return;
    }
    try {
      await (UsageModel as any).create({ runId, ...payload });
    } catch (e:any) {
      if (e?.code !== 11000) {
        await (UsageModel as any).updateOne({ runId }, { $set: payload }, { upsert: true });
      }
    }
  },
};

function mapSet(set: any): any {
  // Minimal mapper to translate $set structure to flat data for Prisma
  if (!set || typeof set !== 'object') return {};
  const out: any = {};
  for (const [k,v] of Object.entries(set)) out[k] = v as any;
  return out;
}
