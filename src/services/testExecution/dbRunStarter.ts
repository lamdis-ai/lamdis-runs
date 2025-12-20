import yaml from 'js-yaml';
import { TestRunModel } from '../../models/TestRun.js';
import { TestSuiteModel } from '../../models/TestSuite.js';
import { TestModel } from '../../models/Test.js';
import { EnvironmentModel } from '../../models/Environment.js';
import { OrganizationModel } from '../../models/Organization.js';
import { PersonaModel } from '../../models/Persona.js';
import { UsageModel } from '../../models/Usage.js';
import { repo } from '../../db/repo.js';
import { writeRunResultToDisk } from '../../lib/resultsStore.js';
import { appendQuery } from '../../lib/url.js';
import { executeRequest } from '../../lib/httpRequests.js';
import { getAtPath } from '../../lib/interpolation.js';
import { runTestsWithEngine, EngineContext, EngineTest } from './engine.js';

export type DbRunStartInput = {
  trigger: 'manual' | 'schedule' | 'ci';
  gitContext?: any;
  authHeader?: string;
  webhookUrl?: string;
  mode?: 'mongo' | 'json';
  suiteId: string;
  envId?: string;
  connKey?: string;
  tests?: string[];
};

export async function startDbBackedRun(body: DbRunStartInput) {
  const suite = repo.isPg()
    ? await repo.getSuiteById(String(body.suiteId))
    : await (TestSuiteModel as any).findById(body.suiteId);
  if (!suite) return { error: 'suite_not_found' } as any;

  let chosenConnKey: string | undefined = undefined;
  if (body.connKey) chosenConnKey = body.connKey;
  if (!chosenConnKey && !body.envId && (suite as any)?.defaultConnectionKey) {
    chosenConnKey = String((suite as any).defaultConnectionKey);
  }

  const run = repo.isPg()
    ? await repo.createTestRun({
        orgId: String((suite as any).orgId),
        suiteId: String((suite as any)._id || (suite as any).id),
        trigger: body.trigger,
        envId: body.envId,
        connectionKey: chosenConnKey,
        status: 'queued',
        gitContext: body.gitContext,
      })
    : await (TestRunModel as any).create({
        orgId: (suite as any).orgId,
        suiteId: (suite as any)._id,
        trigger: body.trigger,
        envId: body.envId,
        connectionKey: chosenConnKey,
        status: 'queued',
        gitContext: body.gitContext,
      });

  void (async () => {
    const runId = String((run as any).id || run._id);
    const startedAt = new Date();
    if (repo.isPg())
      await repo.updateTestRun(runId, {
        status: 'running',
        startedAt,
        progress: {
          status: 'running',
          items: [],
          updatedAt: new Date().toISOString(),
        },
      });
    else
      await (TestRunModel as any).updateOne(
        { _id: run._id },
        {
          $set: {
            status: 'running',
            startedAt,
            progress: {
              status: 'running',
              items: [],
              updatedAt: new Date().toISOString(),
            },
          },
        },
      );

    try {
      const filter: any = { orgId: (suite as any).orgId, suiteId: (suite as any)._id };
      if (body.tests?.length) filter._id = { $in: body.tests };
      const testsRaw = repo.isPg()
        ? await repo.getTests({
            orgId: String((suite as any).orgId),
            suiteId: String((suite as any)._id || (suite as any).id),
            ids: body.tests,
          })
        : await (TestModel as any).find(filter).lean();

      const envId = body.envId || (suite as any).defaultEnvId;
      const envDoc = envId
        ? repo.isPg()
          ? await repo.getEnvironment(
              String((suite as any).orgId),
              String((suite as any)._id || (suite as any).id),
              String(envId),
            )
          : await (EnvironmentModel as any)
              .findOne({ _id: envId, orgId: (suite as any).orgId, suiteId: (suite as any)._id })
              .lean()
        : null;

      let connEnv: { channel: string; baseUrl?: string; headers?: any; timeoutMs?: number } | null = null;
      if (body.connKey) {
        try {
          const org = repo.isPg()
            ? await repo.getOrganizationById(String((suite as any).orgId))
            : await (OrganizationModel as any).findById((suite as any).orgId).lean();
          const key = body.connKey;
          const conn = (org as any)?.connections?.[key];
          if (conn?.base_url) {
            connEnv = {
              channel: 'http_chat',
              baseUrl: conn.base_url,
              headers: undefined,
              timeoutMs: undefined,
            };
          }
        } catch {}
      } else if (!envDoc && (suite as any)?.defaultConnectionKey) {
        try {
          const org = repo.isPg()
            ? await repo.getOrganizationById(String((suite as any).orgId))
            : await (OrganizationModel as any).findById((suite as any).orgId).lean();
          const key = (suite as any).defaultConnectionKey;
          const conn = (org as any)?.connections?.[key];
          if (conn?.base_url) {
            connEnv = {
              channel: 'http_chat',
              baseUrl: conn.base_url,
              headers: undefined,
              timeoutMs: undefined,
            };
            if (!chosenConnKey) {
              chosenConnKey = String(key);
              if (repo.isPg())
                await repo.updateTestRun(runId, {
                  connectionKey: chosenConnKey,
                });
              else
                await (TestRunModel as any).updateOne(
                  { _id: run._id },
                  { $set: { connectionKey: chosenConnKey } },
                );
            }
          }
        } catch {}
      }

      const engineEnv = (connEnv || {
        channel: (envDoc as any)?.channel || 'http_chat',
        baseUrl: (envDoc as any)?.baseUrl,
        headers: (envDoc as any)?.headers,
        timeoutMs: (envDoc as any)?.timeoutMs,
      }) as EngineContext['environment'];

      const wfUrl = process.env.WORKFLOW_URL;
      const authHeader = body.authHeader || undefined;
      const judgeBase = process.env.JUDGE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3101}`;
      const judgeUrl = `${judgeBase}/orgs/${(suite as any).orgId}/judge`;

      const engineTests: EngineTest[] = [];
      for (const t of testsRaw as any[]) {
        let personaText = '';
        try {
          const personaId = (t as any).personaId as string | undefined;
          if (personaId) {
            const p = repo.isPg()
              ? await repo.getPersona(String((suite as any).orgId), String(personaId))
              : await (PersonaModel as any)
                  .findOne({ _id: personaId, orgId: (suite as any).orgId })
                  .lean();
            personaText = (p as any)?.yaml || (p as any)?.text || '';
          }
        } catch {}

        const script = typeof (t as any).script === 'string'
          ? (yaml.load((t as any).script) as any)
          : (t as any).script;

        engineTests.push({
          _id: String((t as any)._id || (t as any).id),
          orgId: String((suite as any).orgId),
          suiteId: String((suite as any)._id || (suite as any).id),
          script,
          personaText,
          steps: (t as any).steps,
          objective: (t as any).objective,
          maxTurns: (t as any).maxTurns,
          iterate: (t as any).iterate,
          continueAfterPass: (t as any).continueAfterPass,
          minTurns: (t as any).minTurns,
          judgeConfig: (t as any).judgeConfig,
        });
      }

      const ctx: EngineContext = {
        orgId: String((suite as any).orgId),
        judgeUrl,
        wfUrl,
        authHeader,
        environment: engineEnv,
      };

      const engineResult = await runTestsWithEngine(engineTests, ctx, {
        executeRequest: async (orgId, requestId, input) => {
          const exec = await executeRequest(orgId, requestId, input, authHeader, () => {});
          return { status: String(exec.status), payload: exec.payload };
        },
        log: async (entry: any) => {
          const fresh = repo.isPg()
            ? await repo.getTestRunById(runId)
            : await (TestRunModel as any).findById(run._id).lean();
          if (fresh?.stopRequested) throw new Error('stopped');
          const itemIdx = 0;
          if (repo.isPg())
            await repo.updateTestRun(runId, {
              progress: {
                status: 'running',
                currentTestId: entry?.currentTestId,
                currentItem: itemIdx,
                tailLogs: [entry],
                updatedAt: new Date().toISOString(),
              },
            });
          else
            await (TestRunModel as any).updateOne(
              { _id: run._id },
              {
                $set: {
                  progress: {
                    status: 'running',
                    currentTestId: entry?.currentTestId,
                    currentItem: itemIdx,
                    tailLogs: [entry],
                    updatedAt: new Date().toISOString(),
                  },
                },
              },
            );
        },
      });

      const { items, passed, failed, skipped, judgeScores } = engineResult;

      const passRate = passed / Math.max(1, passed + failed + skipped);
      let avgJudge: number | undefined = undefined;
      if (judgeScores.length) {
        const normalized = judgeScores.map((s) => {
          if (typeof s !== 'number' || !isFinite(s)) return 0;
          if (s <= 1) return s;
          if (s <= 10) return s / 10;
          return s / 100;
        });
        avgJudge = normalized.reduce((a, b) => a + b, 0) / normalized.length;
      }

      const finishedAt = new Date();
      const runStatus = failed === 0 && skipped === 0 ? 'passed' : failed === 0 ? 'partial' : 'failed';

      const trimmedItems = items.map((it) => ({
        testId: it.testId,
        status: it.status,
        messageCounts: it.messageCounts,
        assertions: it.assertions,
        confirmations: it.confirmations,
        timings: it.timings,
        error: it.error,
      }));

      const runUpdate: any = {
        status: runStatus,
        finishedAt,
        result: {
          items: trimmedItems,
          totals: { passed, failed, skipped },
          passRate,
          judge: { avgScore: avgJudge },
        },
        progress: {
          status: 'completed',
          updatedAt: new Date().toISOString(),
        },
      };

      if (repo.isPg()) await repo.updateTestRun(runId, runUpdate);
      else await (TestRunModel as any).updateOne({ _id: run._id }, { $set: runUpdate });

      try {
        const fullResultDoc = {
          id: runId,
          suiteId: String((suite as any)._id || (suite as any).id),
          orgId: String((suite as any).orgId),
          startedAt,
          finishedAt,
          result: {
            items,
            totals: { passed, failed, skipped },
            passRate,
            judge: { avgScore: avgJudge },
          },
        };
        await writeRunResultToDisk(runId, fullResultDoc as any);
      } catch {}

      const usageDoc: any = {
        orgId: String((suite as any).orgId),
        type: 'test_run',
        suiteId: String((suite as any)._id || (suite as any).id),
        runId,
        totals: { passed, failed, skipped },
        passRate,
        judge: { avgScore: avgJudge },
        createdAt: new Date(),
      };
      if (repo.isPg()) await repo.createOrUpdateUsage(runId, usageDoc);
      else await (UsageModel as any).create(usageDoc);

      if (body.webhookUrl) {
        try {
          const url = appendQuery(body.webhookUrl, {
            runId,
            suiteId: String((suite as any)._id || (suite as any).id),
            orgId: String((suite as any).orgId),
            status: runStatus,
          });
          await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              runId,
              status: runStatus,
              totals: { passed, failed, skipped },
              passRate,
              judge: { avgScore: avgJudge },
            }),
          });
        } catch {}
      }
    } catch (e: any) {
      const errMsg = e?.message || 'run_failed';
      if (repo.isPg())
        await repo.updateTestRun(String((run as any).id || run._id), {
          status: errMsg === 'stopped' ? 'stopped' : 'failed',
          finishedAt: new Date(),
        });
      else
        await (TestRunModel as any).updateOne(
          { _id: run._id },
          {
            $set: {
              status: errMsg === 'stopped' ? 'stopped' : 'failed',
              finishedAt: new Date(),
            },
          },
        );
    }
  })();

  return { id: String((run as any).id || run._id), status: 'queued' } as any;
}
