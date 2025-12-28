// Database-agnostic repository: supports Local/JSON (default), Mongo, and Postgres (via Prisma) at runtime.
// 
// DB_PROVIDER env var controls persistence:
//   - "local"    : In-memory / JSON files (no external DB required)
//   - "mongo"    : MongoDB (requires MONGO_URL)
//   - "postgres" : PostgreSQL via Prisma (requires DATABASE_URL)
//
// Auto-detection when DB_PROVIDER is not set:
//   - DATABASE_URL starting with "postgres" → postgres
//   - MONGO_URL set → mongo
//   - Otherwise → local

import { TestSuiteModel } from '../models/TestSuite.js';
import { TestModel } from '../models/Test.js';
import { EnvironmentModel } from '../models/Environment.js';
import { OrganizationModel } from '../models/Organization.js';
import { PersonaModel } from '../models/Persona.js';
import { RequestModel } from '../models/Request.js';
import { TestRunModel } from '../models/TestRun.js';
import { UsageModel } from '../models/Usage.js';

// In-memory storage for local mode
const localStore: {
  testRuns: Map<string, any>;
  usage: Map<string, any>;
} = {
  testRuns: new Map(),
  usage: new Map(),
};

let idCounter = 0;
function generateLocalId(): string {
  return `local_${Date.now()}_${++idCounter}`;
}

const getProvider = (): 'local' | 'mongo' | 'postgres' => {
  const explicit = String(process.env.DB_PROVIDER || '').toLowerCase();
  if (explicit === 'local' || explicit === 'mongo' || explicit === 'postgres') {
    return explicit;
  }
  // Auto-detect
  if (String(process.env.DATABASE_URL || '').toLowerCase().startsWith('postgres')) {
    return 'postgres';
  }
  if (process.env.MONGO_URL) {
    return 'mongo';
  }
  return 'local';
};

const isPg = () => getProvider() === 'postgres';
const isLocal = () => getProvider() === 'local';
const isMongo = () => getProvider() === 'mongo';

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
  isLocal,
  isMongo,
  getProvider,

  async getSuiteById(id: string) {
    const provider = getProvider();
    if (provider === 'local') {
      // Local mode: suites come from JSON files, not DB
      return null;
    }
    if (provider === 'postgres') {
      const p = await (await getPrisma()).testSuite.findUnique({ where: { id } });
      return p;
    }
    return await (TestSuiteModel as any).findById(id).lean();
  },

  async getTests(filter: { orgId: string; suiteId: string; ids?: string[] }) {
    const provider = getProvider();
    if (provider === 'local') {
      return [];
    }
    if (provider === 'postgres') {
      const where: any = { orgId: filter.orgId, suiteId: filter.suiteId };
      if (filter.ids?.length) where.id = { in: filter.ids };
      return await (await getPrisma()).test.findMany({ where });
    }
    const q: any = { orgId: filter.orgId, suiteId: filter.suiteId };
    if (filter.ids?.length) q._id = { $in: filter.ids };
    return await (TestModel as any).find(q).lean();
  },

  async getEnvironment(orgId: string, suiteId: string, envId: string) {
    const provider = getProvider();
    if (provider === 'local') {
      return null;
    }
    if (provider === 'postgres') {
      return await (await getPrisma()).environment.findFirst({ where: { id: envId, orgId, suiteId } });
    }
    return await (EnvironmentModel as any).findOne({ _id: envId, orgId, suiteId }).lean();
  },

  async getOrganizationById(id: string) {
    const provider = getProvider();
    if (provider === 'local') {
      return null;
    }
    if (provider === 'postgres') {
      return await (await getPrisma()).organization.findUnique({ where: { id } });
    }
    return await (OrganizationModel as any).findById(id).lean();
  },

  async getPersona(orgId: string, personaId: string) {
    const provider = getProvider();
    if (provider === 'local') {
      return null;
    }
    if (provider === 'postgres') {
      return await (await getPrisma()).persona.findFirst({ where: { id: personaId, orgId } });
    }
    return await (PersonaModel as any).findOne({ _id: personaId, orgId }).lean();
  },

  async getRequest(orgId: string, reqKey: string) {
    const provider = getProvider();
    if (provider === 'local') {
      return null;
    }
    if (provider === 'postgres') {
      return await (await getPrisma()).request.findFirst({ where: { orgId, reqKey } });
    }
    return await (RequestModel as any).findOne({ orgId, id: reqKey }).lean();
  },

  async createTestRun(doc: any) {
    const provider = getProvider();
    if (provider === 'local') {
      const id = generateLocalId();
      const run = { ...doc, id, _id: id, createdAt: new Date(), updatedAt: new Date() };
      localStore.testRuns.set(id, run);
      return run;
    }
    if (provider === 'postgres') {
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
    const provider = getProvider();
    if (provider === 'local') {
      const existing = localStore.testRuns.get(runId);
      if (existing) {
        const updated = { ...existing, ...set, updatedAt: new Date() };
        localStore.testRuns.set(runId, updated);
        return updated;
      }
      return null;
    }
    if (provider === 'postgres') {
      return await (await getPrisma()).testRun.update({ where: { id: runId }, data: mapSet(set) });
    }
    return await (TestRunModel as any).updateOne({ _id: runId }, { $set: set });
  },

  async getTestRunById(runId: string) {
    const provider = getProvider();
    if (provider === 'local') {
      return localStore.testRuns.get(runId) || null;
    }
    if (provider === 'postgres') {
      return await (await getPrisma()).testRun.findUnique({ where: { id: runId } });
    }
    return await (TestRunModel as any).findById(runId).lean();
  },

  async createOrUpdateUsage(runId: string, payload: any) {
    const provider = getProvider();
    if (provider === 'local') {
      localStore.usage.set(runId, { runId, ...payload, updatedAt: new Date() });
      return;
    }
    if (provider === 'postgres') {
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
