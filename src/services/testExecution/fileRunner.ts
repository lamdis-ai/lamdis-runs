import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import fetch from 'cross-fetch';
import { z } from 'zod';
import { interpolateDeep, interpolateString } from '../../lib/interpolation.js';
import { executeRequest } from '../../lib/httpRequests.js';
import { synthesizeInitialUserMessage } from '../../lib/initialUserMessage.js';
import { getAtPath } from '../../lib/interpolation.js';

export const runFileBodySchema = z.object({
  filePath: z.string(),
  cwd: z.string().optional(),
  authHeader: z.string().optional(),
});

// NOTE: For now this file inlines the logic from /internal/run-file.
// Once the shared engine abstraction is in place, both this and the
// DB-backed runner will be refactored to use it.

export async function runTestFile(body: z.infer<typeof runFileBodySchema>) {
  const baseDir = body.cwd && body.cwd.trim().length ? body.cwd : process.cwd();
  const absPath = path.isAbsolute(body.filePath)
    ? body.filePath
    : path.join(baseDir, body.filePath);

  if (!fs.existsSync(absPath)) {
    return { statusCode: 404, payload: { error: 'file_not_found', filePath: absPath } };
  }

  let parsed: any;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return { statusCode: 400, payload: { error: 'file_read_or_parse_failed', message: e?.message || 'invalid_json' } };
  }

  const schema = z.object({
    orgId: z.string().optional(),
    suite: z.string().optional(),
    env: z.object({
      channel: z.enum(['http_chat', 'openai_chat', 'bedrock_chat']).default('http_chat'),
      baseUrl: z.string().optional(),
      headers: z.record(z.any()).optional(),
      timeoutMs: z.number().optional(),
    }).optional(),
    imports: z.object({
      personas: z.array(z.string()).optional(),
      requests: z.array(z.string()).optional(),
    }).optional(),
    assistantRef: z.string().optional(),
    tests: z.array(z.any()).default([]),
  });

  let cfg: z.infer<typeof schema>;
  try {
    cfg = schema.parse(parsed);
  } catch (e: any) {
    return { statusCode: 400, payload: { error: 'invalid_test_file', message: e?.message || 'schema_mismatch' } };
  }

  if (!cfg.tests.length) {
    return { statusCode: 400, payload: { error: 'no_tests', message: 'tests[] is empty in file' } };
  }

  const orgId = cfg.orgId || 'file-org';
  const suiteId = `file-suite:${cfg.suite || path.basename(absPath)}`;

  let envDoc: any = cfg.env || { channel: 'http_chat' };
  if (cfg.assistantRef) {
    try {
      const asstPath = path.isAbsolute(cfg.assistantRef)
        ? cfg.assistantRef
        : path.join(path.dirname(absPath), cfg.assistantRef.replace(/^[./]+/, ''));
      if (fs.existsSync(asstPath)) {
        const rawA = fs.readFileSync(asstPath, 'utf8');
        const asst = JSON.parse(rawA);
        if (asst && typeof asst.env === 'object') {
          envDoc = { ...(asst.env || {}), channel: asst.env.channel || envDoc.channel || 'http_chat' };
        }
      }
    } catch {}
  }

  const tests = cfg.tests.map((t: any, idx: number) => ({
    _id: `${suiteId}:test:${idx}`,
    orgId,
    suiteId,
    ...t,
  }));

  const fileRequests: Record<string, any> = {};
  const authBlocks: Record<string, any> = {};
  if (cfg.imports?.requests) {
    for (const rel of cfg.imports.requests) {
      try {
        const p = path.isAbsolute(rel)
          ? rel
          : path.join(path.dirname(absPath), rel.replace(/^[./]+/, ''));
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p, 'utf8');
        const doc = JSON.parse(raw);
        const arr: any[] = Array.isArray(doc?.requests) ? doc.requests : [];
        const auth = doc?.auth;
        if (auth && typeof auth === 'object' && typeof auth.id === 'string') {
          authBlocks[auth.id] = auth;
        }
        for (const r of arr) {
          if (r && typeof r.id === 'string') fileRequests[r.id] = r;
        }
      } catch {}
    }
  }

  const wfUrl = process.env.WORKFLOW_URL;
  const authHeader = body.authHeader || undefined;
  const judgeBase = process.env.JUDGE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3101}`;
  const judgeUrl = `${judgeBase}/orgs/${orgId}/judge`;

  let items: any[] = [];
  let passed = 0, failed = 0, skipped = 0;
  let judgeScores: number[] = [];
  let itemIdx = 0;

  const now = () => new Date().toISOString();

  for (const t of tests) {
    const logs: any[] = [];
    try {
      const tScript = typeof (t as any).script === 'string' ? (yaml.load((t as any).script) as any) : (t as any).script;

      const personaText = '';
      const environment = {
        channel: (envDoc?.channel || 'http_chat'),
        baseUrl: envDoc?.baseUrl,
        headers: envDoc?.headers,
        timeoutMs: envDoc?.timeoutMs,
      };

      let result: any = null;
      const maxTurns = Number((t as any)?.maxTurns || 8);
      const shouldIterate = (t as any)?.iterate !== false;
      const continueAfterPass = (t as any)?.continueAfterPass === true;
      const minTurns = Math.max(1, Number((t as any)?.minTurns || 1));

      if (!wfUrl) {
        const base = (environment.baseUrl);
        const chan = (environment.channel || 'http_chat');
        if (chan === 'http_chat' && base) {
          const chatUrl = `${base.replace(/\/$/, '')}/chat`;
          const msgs = Array.isArray((tScript as any)?.messages) ? (tScript as any).messages : [];
          const stepsArr: any[] = Array.isArray((t as any)?.steps) ? (t as any).steps : [];
          const hasSteps = Array.isArray(stepsArr) && stepsArr.length > 0;
          const pending: string[] = hasSteps ? [] : msgs.filter((m:any)=> String(m?.role||'').toLowerCase()==='user').map((m:any)=> String(m.content||''));
          const objective = String((t as any)?.objective || '').trim();
          if (!hasSteps && (!pending.length || (objective && pending.length && String(pending[0]).trim() === objective))) {
            const first = await synthesizeInitialUserMessage({ orgId: String(orgId), objective, personaText, judgeUrl, authHeader, log: (e:any)=> logs.push(e) });
            if (first && (!pending.length || String(pending[0]).trim() === objective)) {
              if (!pending.length) pending.push(first); else pending[0] = first;
            }
          }
          if (!hasSteps && !pending.length) throw new Error('no_user_message');
          logs.push({ t: now(), type: 'env', env: { channel: chan, baseUrl: base } });
          const transcriptTurns: any[] = [];
          const latencies: number[] = [];
          let fallbackIdx = 0;
          const fallbackPrompts = [
            'Can you share the official page or link where I can do this?',
            'Could you give me simple step-by-step instructions with where to click?',
            'Can you show me a concrete example I could reuse?',
            'Are there any limits, timing rules, or gotchas I should know about?',
            'What are my next steps from here?'
          ];
          const bag: any = { var: {}, last: { assistant: '', user: '', request: undefined }, transcript: transcriptTurns };
          let turns = 0;
          result = {
            status: 'running',
            transcript: transcriptTurns,
            messageCounts: { user: 0, assistant: 0, total: 0 },
            assertions: [],
            confirmations: [],
            timings: {},
          };
          const sendUser = async (userMsg: string) => {
            const outTranscript = [...transcriptTurns, { role: 'user', content: userMsg }];
            const payload: any = { message: String(userMsg), transcript: outTranscript };
            if (personaText) payload.persona = String(personaText).slice(0, 4000);
            const t0 = Date.now();
            const resp = await fetch(chatUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) }, body: JSON.stringify(payload) });
            if (!resp.ok) {
              const errTxt = await resp.text().catch(()=> '');
              throw new Error(`http_chat_failed ${resp.status}: ${errTxt || '(no body)'}`);
            }
            const jr = await resp.json().catch(()=>({}));
            const rawReply = jr?.reply;
            if (typeof rawReply !== 'string' || !rawReply.trim()) throw new Error('reply_missing');
            const replyTxt = rawReply;
            const dt = Date.now() - t0; latencies.push(dt);
            transcriptTurns.push({ role: 'user', content: userMsg });
            transcriptTurns.push({ role: 'assistant', content: String(replyTxt) });
            bag.last = { assistant: String(replyTxt), user: userMsg, request: bag.last?.request };
            logs.push({ t: now(), type: 'assistant_reply', content: String(replyTxt), latencyMs: dt });
          };

          if (hasSteps) {
            for (const rawStep of stepsArr) {
              const step = rawStep || {};
              const type = String(step.type || '').toLowerCase();
              if (type === 'message') {
                const role = String(step.role || 'user').toLowerCase();
                const contentTpl = step.content;
                const root = { ...bag, lastAssistant: bag?.last?.assistant, lastUser: bag?.last?.user };
                const content = interpolateString(String(contentTpl || ''), root);
                if (role === 'system') {
                  transcriptTurns.push({ role: 'system', content });
                  logs.push({ t: now(), type: 'system_message', content });
                } else {
                  logs.push({ t: now(), type: 'user_message', content });
                  await sendUser(content);
                  turns++;
                  if (turns >= maxTurns) break;
                }
              } else if (type === 'request' && step.requestId) {
                const root = { ...bag, lastAssistant: bag?.last?.assistant, lastUser: bag?.last?.user };
                const input = interpolateDeep(step.input ?? {}, root);
                try {
                  const exec = await executeRequest(orgId, String(step.requestId), input, authHeader, (e:any)=> logs.push(e), fileRequests, authBlocks);
                  bag.last = { ...bag.last, request: exec.payload };
                  const key = String(step.assign || step.requestId);
                  if (key) bag.var[key] = exec.payload;
                  logs.push({ t: now(), type: 'request', stage: 'step', requestId: String(step.requestId), status: exec.status });
                } catch (e:any) {
                  logs.push({ t: now(), type: 'request_error', stage: 'step', requestId: String(step.requestId), error: e?.message || 'exec_failed' });
                }
              } else if (type === 'assistant_check') {
                const mode = String((step as any).mode || 'judge');
                if (mode === 'judge') {
                  const rubric = String((step as any).rubric || '').trim();
                  if (!rubric) {
                    logs.push({ t: now(), type: 'step_skip', subtype: 'assistant_check_judge', reason: 'missing_rubric', step });
                  } else {
                    try {
                      const scope = (step as any).scope || 'last';
                      const lastAssistant = String(transcriptTurns.slice().reverse().find((m:any)=>m.role==='assistant')?.content || '');
                      const judgeBody = { rubric, threshold: (step as any).threshold, transcript: transcriptTurns, lastAssistant, scope };
                      const judgeResp = await fetch(judgeUrl, {
                        method:'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(judgeBody)
                      });
                      const j = await judgeResp.json().catch(()=>({}));
                      const pass = !!j?.pass;
                      const details = { score: j?.score, threshold: j?.threshold, reasoning: j?.reasoning, error: j?.error };
                      logs.push({ t: now(), type: 'judge_check', subtype: 'assistant_check_judge', pass, details });
                      const stepAssertion = { type: 'assistant_check', subtype: 'judge', pass, details, stepId: (step as any).id, name: (step as any).name, severity: (step as any).severity || 'error' };
                      (result as any).assertions = Array.isArray((result as any).assertions)
                        ? [...(result as any).assertions, stepAssertion]
                        : [stepAssertion];
                    } catch (e:any) {
                      const details = { error: e?.message || 'judge_failed' };
                      logs.push({ t: now(), type: 'step_error', subtype: 'assistant_check_judge', message: details.error, step });
                      const stepAssertion = { type: 'assistant_check', subtype: 'judge', pass: false, details, stepId: (step as any).id, name: (step as any).name, severity: (step as any).severity || 'error' };
                      (result as any).assertions = Array.isArray((result as any).assertions)
                        ? [...(result as any).assertions, stepAssertion]
                        : [stepAssertion];
                    }
                  }
                } else {
                  logs.push({ t: now(), type: 'step_skip', subtype: 'assistant_check', reason: 'unknown_mode', step });
                }
              } else {
                logs.push({ t: now(), type: 'step_skip', reason: 'unknown_type', raw: step });
              }
            }
          } else {
            while (pending.length && turns < maxTurns) {
              const userMsg = String(pending.shift() || '');
              logs.push({ t: now(), type: 'user_message', content: userMsg });
              await sendUser(userMsg);
              turns++;

              if (shouldIterate && (t as any)?.judgeConfig?.rubric) {
                try {
                  const rubric = (t as any)?.judgeConfig?.rubric;
                  const threshold = (t as any)?.judgeConfig?.threshold;
                  const lastA = String(transcriptTurns.slice().reverse().find((m:any)=>m.role==='assistant')?.content || '');
                  const judgeBody = { rubric, threshold, transcript: transcriptTurns, lastAssistant: lastA, requestNext: true, persona: personaText };
                  const judgeResp = await fetch(judgeUrl, { method:'POST', headers: { 'content-type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) }, body: JSON.stringify(judgeBody) });
                  const j = await judgeResp.json();
                  const pass = !!j?.pass;
                  const details = { score: j?.score, threshold: j?.threshold, reasoning: j?.reasoning, error: j?.error };
                  logs.push({ t: now(), type: 'judge_check', subtype: 'semantic', pass, details });
                  const haveMinTurns = turns >= minTurns;
                  const nextUserRaw = typeof j?.nextUser === 'string' ? j.nextUser : '';
                  const shouldContinue = j?.shouldContinue !== false;
                  let willBreak = false;
                  if (pass) {
                    if (!continueAfterPass && haveMinTurns) {
                      willBreak = true;
                    } else {
                      logs.push({ t: now(), type: 'judge_decision', content: `pass but continuing (minTurns=${minTurns}, continueAfterPass=${continueAfterPass})` });
                    }
                  }
                  if (willBreak) break;
                  if (shouldContinue && turns < maxTurns) {
                    let nextUser = nextUserRaw;
                    if (!nextUser) {
                      const lastUserPrev = transcriptTurns.slice().reverse().find((m:any)=>m.role==='user')?.content || '';
                      for (let k=0;k<fallbackPrompts.length;k++) {
                        const idx = (fallbackIdx + k) % fallbackPrompts.length;
                        const cand = fallbackPrompts[idx];
                        if (String(cand).trim().toLowerCase() !== String(lastUserPrev).trim().toLowerCase()) { nextUser = cand; fallbackIdx = (idx+1)%fallbackPrompts.length; break; }
                      }
                      nextUser = nextUser || fallbackPrompts[0];
                    }
                    if (nextUser) {
                      const lastUserPrev = transcriptTurns.slice().reverse().find((m:any)=>m.role==='user')?.content || '';
                      if (String(nextUser).trim().toLowerCase() !== String(lastUserPrev).trim().toLowerCase()) {
                        pending.push(String(nextUser));
                        logs.push({ t: now(), type: 'plan', content: `next_user: ${String(nextUser).slice(0,200)}` });
                      } else {
                        logs.push({ t: now(), type: 'plan_skip', content: 'skipped duplicate follow-up' });
                        break;
                      }
                    } else {
                      break;
                    }
                  }
                } catch (e:any) {
                  logs.push({ t: now(), type: 'judge_check', subtype: 'semantic', pass: false, details: { error: e?.message || 'judge_failed' } });
                }
              }
            }
          }
          const stats = (()=>{
            const arr = latencies.slice().sort((a,b)=>a-b);
            const pick = (p:number)=> arr.length ? arr[Math.min(arr.length-1, Math.floor(p*(arr.length-1)))] : undefined;
            const avg = arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : undefined;
            return { perTurnMs: latencies, avgMs: avg, p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: arr.length?arr[arr.length-1]:undefined };
          })();
          const msgCounts = { user: transcriptTurns.filter(m=>m.role==='user').length, assistant: transcriptTurns.filter(m=>m.role==='assistant').length, total: transcriptTurns.length };
          if (!result || typeof result !== 'object') result = {};
          result.status = 'passed';
          result.transcript = transcriptTurns;
          result.messageCounts = msgCounts;
          result.assertions = Array.isArray(result.assertions) ? result.assertions : [];
          result.confirmations = Array.isArray(result.confirmations) ? result.confirmations : [];
          result.timings = stats;
        } else {
          throw new Error('workflow_unconfigured');
        }
      } else {
        const r = await fetch(`${wfUrl}/testing/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script: tScript, environment, variables: {}, judge: { url: judgeUrl, orgId: String(orgId) } }) });
        result = await r.json();
      }

      let status = result?.status || 'failed';
      const combinedAssertions = Array.isArray(result?.assertions) ? result.assertions : [];
      const anyFail = combinedAssertions.some((a:any)=> a && a.pass === false && (a.severity||'error') !== 'info');
      if (anyFail) status = 'failed';

      items.push({ testId: String((t as any)._id), status, transcript: result.transcript, messageCounts: result.messageCounts, assertions: combinedAssertions, confirmations: result.confirmations, timings: result.timings, error: result.error, artifacts: { log: logs } });
      itemIdx++;
      if (status === 'passed') passed++; else failed++;
    } catch (e:any) {
      items.push({ testId: String((t as any)._id), status: 'failed', error: { message: e?.message || 'exec_failed' } });
      failed++;
    }
  }

  const passRate = passed / Math.max(1, passed + failed + skipped);
  let avgJudge: number | undefined = undefined;
  if (judgeScores.length) {
    const normalized = judgeScores.map((s) => {
      if (typeof s !== 'number' || !isFinite(s)) return 0;
      if (s <= 1) return s;
      if (s <= 10) return s / 10;
      return s / 100;
    });
    avgJudge = normalized.reduce((a,b)=>a+b,0) / normalized.length;
  }

  const summary = {
    file: absPath,
    totals: { passed, failed, skipped },
    passRate,
    judge: { avgScore: avgJudge },
    items: items.map(it => ({
      testId: it.testId,
      status: it.status,
      assertions: it.assertions,
      error: it.error,
    })),
  };

  return { statusCode: 200, payload: summary };
}
