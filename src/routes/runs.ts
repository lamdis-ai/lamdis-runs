import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TestRunModel } from '../models/TestRun.js';
import { TestSuiteModel } from '../models/TestSuite.js';
import { TestModel } from '../models/Test.js';
import { EnvironmentModel } from '../models/Environment.js';
import { OrganizationModel } from '../models/Organization.js';
import { PersonaModel } from '../models/Persona.js';
import { RequestModel } from '../models/Request.js';
import { decrypt } from '../lib/crypto.js';
import yaml from 'js-yaml';
import fetch from 'cross-fetch';
import crypto from 'crypto';
import { UsageModel } from '../models/Usage.js';
import { repo } from '../db/repo.js';
import { bedrockChatOnce } from '../lib/bedrockRuntime.js';
import fs from 'fs';
import path from 'path';
import { writeRunResultToDisk } from '../lib/resultsStore.js';
import { getAtPath, interpolateString, interpolateDeep } from '../lib/interpolation.js';
import { sanitizeInitialUserMessage, synthesizeInitialUserMessage } from '../lib/initialUserMessage.js';
import { appendQuery } from '../lib/url.js';
import { resolveAuthHeaderFromBlock, executeRequest } from '../lib/httpRequests.js';
import { judgeBodySchema, judgeConversation } from '../services/judgeService.js';
import { registerRunsAuth } from '../services/runsAuth.js';
import { runFileBodySchema, runTestFile } from '../services/testExecution/fileRunner.js';
import { jsonSuitesBodySchema, runJsonSuites } from '../services/testExecution/jsonSuitesRunner.js';
import { startDbBackedRun } from '../services/testExecution/dbRunStarter.js';

export default async function runsRoutes(app: FastifyInstance) {
  // Local judge endpoint (OpenAI/Bedrock-backed) — now delegated to judgeService
  app.post('/orgs/:orgId/judge', async (req) => {
    const body = judgeBodySchema.parse(req.body as any);
    const out = await judgeConversation(body);
    const mongoSchema = z.object({
      trigger: z.enum(['manual','schedule','ci']).default('ci'),
      gitContext: z.any().optional(),
      authHeader: z.string().optional(),
      webhookUrl: z.string().url().optional(),
      mode: z.enum(['mongo','json']).optional(),
      suiteId: z.string(),
      envId: z.string().optional(),
      connKey: z.string().optional(),
      tests: z.array(z.string()).optional(),
    });

    const body = mongoSchema.parse(raw);
    return startDbBackedRun(body as any);
                    if (fresh3?.stopRequested) throw new Error('stopped');
                  }
                } else while (pending.length && turns < maxTurns) {
                  const fresh3 = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
                  if (fresh3?.stopRequested) throw new Error('stopped');
                  const userMsg = String(pending.shift() || '');
                  await sendUser(userMsg);
                  turns++;
                  if (shouldIterate && (semA && semA.config?.rubric || (t as any)?.judgeConfig?.rubric)) {
                    try {
                      const rubric = semA?.config?.rubric || (t as any)?.judgeConfig?.rubric;
                      const threshold = semA?.config?.threshold ?? (t as any)?.judgeConfig?.threshold;
                      const lastA2 = String(transcriptTurns.slice().reverse().find((m:any)=>m.role==='assistant')?.content || '');
                      const judgeBody = { rubric, threshold, transcript: transcriptTurns, lastAssistant: lastA2, requestNext: true, persona: personaText };
                      const judgeResp = await fetch(judgeUrl, { method:'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(judgeBody) });
                      const j = await judgeResp.json();
                      const pass = !!j?.pass;
                      const details = { score: j?.score, threshold: j?.threshold, reasoning: j?.reasoning };
                      logs.push({ t: now(), type: 'judge_check', subtype: 'semantic', pass, details });
                      if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { progress: { status: 'running', currentTestId: String((t as any)._id || (t as any).id), currentItem: itemIdx, lastJudge: { pass, details }, lastTurnAt: new Date().toISOString(), tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } });
                      else await (TestRunModel as any).updateOne(
                        { _id: run._id },
                        { $set: { progress: { status: 'running', currentTestId: String((t as any)._id), currentItem: itemIdx, lastJudge: { pass, details }, lastTurnAt: new Date().toISOString(), tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } } }
                      );
                      const nextUserRaw = typeof j?.nextUser === 'string' ? j.nextUser : '';
                      const shouldContinue = j?.shouldContinue !== false;
                      let willBreak = false;
                      const haveMinTurns = turns >= minTurns;
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
                          const fps = fallbackPrompts;
                          for (let k=0;k<fps.length;k++) {
                            const idx = (fallbackIdx + k) % fps.length;
                            const cand = fps[idx];
                            if (String(cand).trim().toLowerCase() !== String(lastUserPrev).trim().toLowerCase()) { nextUser = cand; fallbackIdx = (idx+1)%fps.length; break; }
                          }
                          nextUser = nextUser || fps[0];
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
                const stats = (()=>{
                  const arr = latencies.slice().sort((a,b)=>a-b);
                  const pick = (p:number)=> arr.length ? arr[Math.min(arr.length-1, Math.floor(p*(arr.length-1)))] : undefined;
                  const avg = arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : undefined;
                  return { perTurnMs: latencies, avgMs: avg, p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: arr.length?arr[arr.length-1]:undefined };
                })();
                const msgCounts = { user: transcriptTurns.filter(m=>m.role==='user').length, assistant: transcriptTurns.filter(m=>m.role==='assistant').length, total: transcriptTurns.length };
                result = { status: 'passed', transcript: transcriptTurns, messageCounts: msgCounts, assertions: [], confirmations: [], timings: stats };
              } else if (chan === 'bedrock_chat') {
                // Support separate chat model/temperature; fall back to legacy BEDROCK_MODEL_ID/BEDROCK_TEMPERATURE
                const bedrockModelId = process.env.BEDROCK_CHAT_MODEL_ID || process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
                const bedrockTemp = process.env.BEDROCK_CHAT_TEMPERATURE ? Number(process.env.BEDROCK_CHAT_TEMPERATURE) : (process.env.BEDROCK_TEMPERATURE ? Number(process.env.BEDROCK_TEMPERATURE) : 0.3);
                const msgs = Array.isArray((tScript as any)?.messages) ? (t as any).script.messages : [];
                const stepsArr: any[] = Array.isArray((t as any)?.steps) ? (t as any).steps : [];
                const hasSteps = Array.isArray(stepsArr) && stepsArr.length > 0;
                const pending: string[] = hasSteps ? [] : msgs.filter((m:any)=> String(m?.role||'').toLowerCase()==='user').map((m:any)=> String(m.content||''));
                const objective = String((t as any)?.objective || '').trim();
                if (!hasSteps && (!pending.length || (objective && pending.length && String(pending[0]).trim() === objective))) {
                  const first = await synthesizeInitialUserMessage({ orgId: String((suite as any).orgId), objective, personaText, judgeUrl, authHeader, log: (e:any)=> logs.push(e) });
                  if (first && (!pending.length || String(pending[0]).trim() === objective)) {
                    if (!pending.length) pending.push(first); else pending[0] = first;
                  }
                }
                if (!hasSteps && !pending.length) throw new Error('no_user_message');
                logs.push({ t: now(), type: 'env', env: { channel: chan, model: bedrockModelId } });
                if ((t as any).personaId) logs.push({ t: now(), type: 'persona', personaId: (t as any).personaId });
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
                const systemMsgs = Array.isArray((tScript as any)?.messages) ? (tScript as any).messages.filter((m:any)=> String(m?.role||'').toLowerCase()==='system') : [];
                let baseMessages: any[] = [];
                if (personaText) baseMessages.push({ role: 'system', content: String(personaText).slice(0, 4000) });
                baseMessages = [...baseMessages, ...systemMsgs];
                let turns = 0;
                const bag: any = { var: {}, last: { assistant: '', user: '', request: undefined }, transcript: transcriptTurns };
                const sendUser = async (userMsg:string) => {
                  transcriptTurns.push({ role: 'user', content: userMsg });
                  logs.push({ t: now(), type: 'user_message', content: userMsg });
                  const chatMessages = [...baseMessages, ...transcriptTurns.map(m=> ({ role: m.role, content: m.content }))];
                  const t0 = Date.now();
                  const reply = await bedrockChatOnce({ modelId: bedrockModelId, temperature: bedrockTemp, messages: chatMessages });
                  if (!reply || !String(reply).trim()) throw new Error('reply_missing');
                  const dt = Date.now() - t0; latencies.push(dt);
                  transcriptTurns.push({ role: 'assistant', content: String(reply) });
                  bag.last = { assistant: String(reply), user: userMsg, request: bag.last?.request };
                  logs.push({ t: now(), type: 'assistant_reply', content: String(reply), latencyMs: dt });
                  if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { progress: { status: 'running', currentTestId: String((t as any)._id || (t as any).id), currentItem: itemIdx, lastTurnAt: new Date().toISOString(), lastAssistant: String(reply), lastUser: userMsg, lastLatencyMs: dt, tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } });
                  else await (TestRunModel as any).updateOne(
                    { _id: run._id },
                    { $set: { progress: { status: 'running', currentTestId: String((t as any)._id), currentItem: itemIdx, lastTurnAt: new Date().toISOString(), lastAssistant: String(reply), lastUser: userMsg, lastLatencyMs: dt, tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } } }
                  );
                };

                if (hasSteps) {
                  for (const rawStep of stepsArr) {
                    const step = rawStep || {};
                    const type = String(step.type || '').toLowerCase();
                    if (type === 'message') {
                      const role = String(step.role || 'user').toLowerCase();
                      const root = { ...bag, lastAssistant: bag?.last?.assistant, lastUser: bag?.last?.user };
                      const content = interpolateString(String(step.content || ''), root);
                      if (role === 'system') {
                        baseMessages.push({ role: 'system', content });
                        logs.push({ t: now(), type: 'system_message', content });
                      } else {
                        await sendUser(content);
                        turns++;
                        if (turns >= maxTurns) break;
                      }
                    } else if (type === 'request' && step.requestId) {
                      const root = { ...bag, lastAssistant: bag?.last?.assistant, lastUser: bag?.last?.user };
                      const input = interpolateDeep(step.input ?? {}, root);
                      try {
                        const exec = await executeRequest((suite as any).orgId, String(step.requestId), input, authHeader, (e:any)=> logs.push(e));
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
                            const lastAssistant = String(transcriptTurns.slice().reverse().find((m:any)=>m.role==='assistant')?.content || '');
                            const judgeBody = { rubric, threshold: (step as any).threshold, transcript: transcriptTurns, lastAssistant };
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
                    const fresh3 = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
                    if (fresh3?.stopRequested) throw new Error('stopped');
                  }
                } else while (pending.length && turns < maxTurns) {
                  const fresh3 = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
                  if (fresh3?.stopRequested) throw new Error('stopped');
                  const userMsg = String(pending.shift() || '');
                  await sendUser(userMsg);
                  turns++;
                  if (shouldIterate && (semA && semA.config?.rubric || (t as any)?.judgeConfig?.rubric)) {
                    try {
                      const rubric = semA?.config?.rubric || (t as any)?.judgeConfig?.rubric;
                      const threshold = semA?.config?.threshold ?? (t as any)?.judgeConfig?.threshold;
                      const lastA2 = String(transcriptTurns.slice().reverse().find((m:any)=>m.role==='assistant')?.content || '');
                      const judgeBody = { rubric, threshold, transcript: transcriptTurns, lastAssistant: lastA2, requestNext: true, persona: personaText };
                      const judgeResp = await fetch(judgeUrl, { method:'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(judgeBody) });
                      const j = await judgeResp.json();
                      const pass = !!j?.pass;
                      const details = { score: j?.score, threshold: j?.threshold, reasoning: j?.reasoning };
                      logs.push({ t: now(), type: 'judge_check', subtype: 'semantic', pass, details });
                      if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { progress: { status: 'running', currentTestId: String((t as any)._id || (t as any).id), currentItem: itemIdx, lastJudge: { pass, details }, lastTurnAt: new Date().toISOString(), tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } });
                      else await (TestRunModel as any).updateOne(
                        { _id: run._id },
                        { $set: { progress: { status: 'running', currentTestId: String((t as any)._id), currentItem: itemIdx, lastJudge: { pass, details }, lastTurnAt: new Date().toISOString(), tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } } }
                      );
                      const nextUserRaw = typeof j?.nextUser === 'string' ? j.nextUser : '';
                      const shouldContinue = j?.shouldContinue !== false;
                      let willBreak = false;
                      const haveMinTurns = turns >= minTurns;
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
                          const fps = fallbackPrompts;
                          for (let k=0;k<fps.length;k++) {
                            const idx = (fallbackIdx + k) % fps.length;
                            const cand = fps[idx];
                            if (String(cand).trim().toLowerCase() !== String(lastUserPrev).trim().toLowerCase()) { nextUser = cand; fallbackIdx = (idx+1)%fps.length; break; }
                          }
                          nextUser = nextUser || fps[0];
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
                const stats = (()=>{
                  const arr = latencies.slice().sort((a,b)=>a-b);
                  const pick = (p:number)=> arr.length ? arr[Math.min(arr.length-1, Math.floor(p*(arr.length-1)))] : undefined;
                  const avg = arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : undefined;
                  return { perTurnMs: latencies, avgMs: avg, p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: arr.length?arr[arr.length-1]:undefined };
                })();
                const msgCounts = { user: transcriptTurns.filter(m=>m.role==='user').length, assistant: transcriptTurns.filter(m=>m.role==='assistant').length, total: transcriptTurns.length };
                result = { status: 'passed', transcript: transcriptTurns, messageCounts: msgCounts, assertions: [], confirmations: [], timings: stats };
              } else {
                throw new Error('workflow_unconfigured');
              }
            } else {
              // External workflow engine
              const r = await fetch(`${wfUrl}/testing/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script: tScript, environment, variables: {}, judge: { url: judgeUrl, orgId: String((suite as any).orgId) } }) });
              result = await r.json();
            }

            // Hooks removed: only steps are supported. All setup/teardown must be modeled as steps.

            // After hooks and extra assertions
            // Ensure assertions array exists so step-level handlers (e.g. assistant_check)
            // that append into result.assertions never crash on null/undefined.
            if (!Array.isArray((result as any).assertions)) {
              (result as any).assertions = [];
            }
            const extraAssertions: any[] = [];
            try {
              const transcript: any[] = Array.isArray(result.transcript) ? result.transcript : [];
              const lastAssistant = transcript.slice().reverse().find((m:any)=>m.role==='assistant')?.content || '';
              const tAssertions: any[] = Array.isArray((t as any).assertions) ? (t as any).assertions : [];
              for (const a of tAssertions) {
                if (!a || typeof a !== 'object') continue;
                if (a.type === 'includes') {
                  const inc: string[] = Array.isArray(a.config?.includes) ? a.config.includes : [];
                  // Default to whole transcript unless explicitly set to 'last'
                  const scope = a.config?.scope === 'last' ? 'last' : 'transcript';
                  const hay = scope==='transcript' ? JSON.stringify(transcript).toLowerCase() : String(lastAssistant).toLowerCase();
                  const misses = inc.filter((k:string)=> !hay.includes(String(k||'').toLowerCase()));
                  const pass = misses.length === 0;
                  const incRes = { type: 'includes', severity: a.severity||'error', config: a.config, pass, details: { misses } };
                  extraAssertions.push(incRes);
                  logs.push({ t: now(), type: 'judge_check', subtype: 'includes', pass, details: incRes.details });
                }
                if (a.type === 'semantic' && a.config?.rubric) {
                  try {
                    const judgeResp = await fetch(judgeUrl, { method:'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rubric: a.config.rubric, threshold: a.config.threshold, transcript, lastAssistant }) });
                    const j = await judgeResp.json();
                    const pass = !!j.pass;
                    const details = { score: j.score, threshold: j.threshold, reasoning: j.reasoning };
                    extraAssertions.push({ type: 'semantic', severity: a.severity||'error', config: a.config, pass, details });
                    logs.push({ t: now(), type: 'judge_check', subtype: 'semantic', pass, details });
                    if (typeof j.score === 'number') judgeScores.push(Number(j.score));
                  } catch (e:any) {
                    const details = { error: e?.message || 'judge_failed' };
                    extraAssertions.push({ type: 'semantic', severity: a.severity||'error', config: a.config, pass: false, details });
                    logs.push({ t: now(), type: 'judge_check', subtype: 'semantic', pass: false, details });
                  }
                }
                if ((a as any).type === 'request' && (a as any).config?.requestId) {
                  try {
                    const input = (((a as any).config?.input) || {});
                    const exec = await executeRequest((suite as any).orgId, String((a as any).config.requestId), input, authHeader, (e:any)=> logs.push(e));
                    const path = String(((a as any).config?.expect?.path) || '');
                    const expected = (a as any).config?.expect?.equals;
                    const actual = path ? getAtPath(exec.payload, path) : exec.payload;
                    const pass = String(actual) === String(expected);
                    const details = { path, expected, actual, status: exec.status };
                    extraAssertions.push({ type: 'request', severity: (a as any).severity||'error', config: (a as any).config, pass, details });
                    logs.push({ t: now(), type: 'judge_check', subtype: 'request', pass, details });
                  } catch (e:any) {
                    const details = { error: e?.message || 'request_assert_failed' };
                    extraAssertions.push({ type: 'request', severity: (a as any).severity||'error', config: (a as any).config, pass: false, details });
                    logs.push({ t: now(), type: 'judge_check', subtype: 'request', pass: false, details });
                  }
                }
              }
            } catch {}
            // No after hooks; assertions executed directly after step execution.

            let status = result?.status || 'failed';
            const baseAssertions = Array.isArray(result.assertions) ? result.assertions : [];
            const combinedAssertions = [...baseAssertions, ...extraAssertions];
            const anyFail = combinedAssertions.some((a:any)=> a && a.pass === false && (a.severity||'error') !== 'info');
            if (anyFail) status = 'failed';

            items.push({ testId: String((t as any)._id), status, transcript: result.transcript, messageCounts: result.messageCounts, assertions: combinedAssertions, confirmations: result.confirmations, timings: result.timings, error: result.error, artifacts: { log: logs } });
            itemIdx++;
            if (status === 'passed') passed++; else failed++;
          } catch (e:any) {
            if (String(e?.message||'') === 'stopped') {
              items.push({ testId: String((t as any)._id), status: 'failed', error: { message: 'stopped' } });
              // Mark run as stopped and break out of test loop
              if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { status: 'stopped', finishedAt: new Date() });
              else await (TestRunModel as any).updateOne({ _id: run._id }, { $set: { status: 'stopped', finishedAt: new Date() } });
              break;
            } else {
              // Preserve as much context as possible if assertion processing blows up.
              const rawMsg = e?.message || 'exec_failed';
              const cleanMsg = rawMsg && rawMsg.includes("reading 'assertions'")
                ? 'Internal runner error while processing assertions'
                : rawMsg;
              const safeResult: any = result && typeof result === 'object' ? result : {};
              const baseAssertions = Array.isArray(safeResult.assertions) ? safeResult.assertions : [];
              const baseTranscript = Array.isArray(safeResult.transcript) ? safeResult.transcript : [];
              const baseMessageCounts = safeResult.messageCounts && typeof safeResult.messageCounts === 'object'
                ? safeResult.messageCounts
                : undefined;
              const baseConfirmations = Array.isArray(safeResult.confirmations) ? safeResult.confirmations : [];
              const baseTimings = safeResult.timings && typeof safeResult.timings === 'object' ? safeResult.timings : undefined;
              items.push({
                testId: String((t as any)._id),
                status: 'failed',
                transcript: baseTranscript,
                messageCounts: baseMessageCounts,
                assertions: baseAssertions,
                confirmations: baseConfirmations,
                timings: baseTimings,
                error: { message: cleanMsg },
                artifacts: { log: logs }
              });
              failed++;
            }
          }
        }

  const finishedAt = new Date();
        const passRate = passed / Math.max(1, passed + failed + skipped);
        // Aggregate message counts across items
        const totalMsg = (()=>{
          let user = 0, assistant = 0, total = 0;
          for (const it of items) {
            const mc = (it as any).messageCounts || {};
            if (typeof mc.user === 'number') user += mc.user;
            if (typeof mc.assistant === 'number') assistant += mc.assistant;
            if (typeof mc.total === 'number') total += mc.total;
          }
          return { user, assistant, total };
        })();
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
        const th = (suite as any).thresholds || {};
        const passRateMin = typeof th.passRate === 'number' ? th.passRate : 0.99;
        const judgeMin = typeof th.judgeScore === 'number' ? th.judgeScore : 0.75;
        const meetsPassRate = passRate >= passRateMin;
        const meetsJudge = avgJudge === undefined ? true : (avgJudge >= judgeMin);
        // If stop requested occurred, preserve 'stopped' status, else compute final
  const latest = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
        const finalStatus = (latest?.status === 'stopped') ? 'stopped' : ((meetsPassRate && meetsJudge) ? 'passed' : (passed > 0 ? 'partial' : 'failed'));

        // First, update the top-level status and summary only so the run never remains "running" even if items are large
        if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { status: finalStatus, finishedAt, totals: { passed, failed, skipped, messageCounts: totalMsg }, summaryScore: passRate, judge: { avgScore: avgJudge, thresholds: { passRate: passRateMin, judgeScore: judgeMin }, meets: { passRate: meetsPassRate, judge: meetsJudge } } });
        else await (TestRunModel as any).updateOne(
          { _id: run._id },
          { $set: { status: finalStatus, finishedAt, totals: { passed, failed, skipped, messageCounts: totalMsg }, summaryScore: passRate, judge: { avgScore: avgJudge, thresholds: { passRate: passRateMin, judgeScore: judgeMin }, meets: { passRate: meetsPassRate, judge: meetsJudge } } } as any }
        );

        // Record usage for billing/visibility
        try {
          const startedAtVal = startedAt;
          const durationSec = Math.max(0, Math.round(((finishedAt as any) - (startedAtVal as any)) / 1000));
          await repo.createOrUpdateUsage(String((run as any).id || run._id), {
            orgId: String((suite as any).orgId),
            suiteId: String((suite as any)._id || (suite as any).id),
            envId: body.envId || (suite as any).defaultEnvId || undefined,
            connectionKey: chosenConnKey,
            status: finalStatus,
            startedAt: startedAtVal,
            finishedAt,
            durationSec,
            itemsCount: Array.isArray(items) ? items.length : undefined,
          });
        } catch {}

        // Then, persist items in a trimmed form to avoid hitting Mongo's 16MB document limit
        const clampStr = (s: any, max = 2000) => {
          const t = String(s ?? '');
          return t.length > max ? t.slice(0, max) + '…' : t;
        };
        const trimItem = (it: any) => {
          const transcript = Array.isArray(it.transcript) ? it.transcript.slice(-40).map((m:any)=> ({
            role: m.role,
            content: clampStr(m.content, 4000)
          })) : [];
          const messageCounts = (it as any).messageCounts && typeof (it as any).messageCounts === 'object' ? {
            user: Number((it as any).messageCounts.user || 0),
            assistant: Number((it as any).messageCounts.assistant || 0),
            total: Number((it as any).messageCounts.total || 0)
          } : undefined;
          // Keep only the last 300 log entries and clamp each entry's content-like fields
          const rawLogs: any[] = Array.isArray(it?.artifacts?.log) ? it.artifacts.log : [];
          const logs = rawLogs.slice(-300).map((e:any)=> ({
            ...e,
            content: e && typeof e.content === 'string' ? clampStr(e.content, 4000) : e?.content,
            error: e && typeof e.error === 'string' ? clampStr(e.error, 1000) : e?.error,
          }));
          const assistantChecks = Array.isArray((it as any).assistantChecks)
            ? (it as any).assistantChecks.map((c:any)=>({
                stepId: c.stepId,
                name: c.name,
                mode: c.mode,
                rubric: typeof c.rubric === 'string' ? clampStr(c.rubric, 2000) : c.rubric,
                threshold: c.threshold,
              }))
            : undefined;
          return {
            testId: String(it.testId),
            status: String(it.status),
            transcript,
            ...(messageCounts ? { messageCounts } : {}),
            assertions: Array.isArray(it.assertions) ? it.assertions : [],
            confirmations: Array.isArray(it.confirmations) ? it.confirmations : [],
            timings: it.timings,
            error: it.error,
            ...(assistantChecks ? { assistantChecks } : {}),
            artifacts: { log: logs }
          };
        };
        const trimmedItems = Array.isArray(items) ? items.map(trimItem) : [];

        // Best-effort: write full run result to disk for debugging/CI artifacts
        try {
          await writeRunResultToDisk(String((run as any).id || run._id), {
            runId: String((run as any).id || run._id),
            suiteId: String((suite as any)._id || (suite as any).id),
            orgId: String((suite as any).orgId),
            status: finalStatus,
            totals: { passed, failed, skipped, messageCounts: totalMsg },
            passRate,
            judge: {
              avgScore: avgJudge,
              thresholds: { passRate: passRateMin, judgeScore: judgeMin },
              meets: { passRate: meetsPassRate, judge: meetsJudge },
            },
            items: trimmedItems,
            gitContext: body.gitContext,
            envId: body.envId || (suite as any).defaultEnvId || undefined,
            connectionKey: chosenConnKey,
          });
        } catch {}

        try {
          if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { items: trimmedItems });
          else await (TestRunModel as any).updateOne(
            { _id: run._id },
            { $set: { items: trimmedItems } as any }
          );
        } catch (e:any) {
          // If storing items fails (e.g., document too large), leave status finalized and attach a small tail for debugging
          const tailItem = trimmedItems.slice(-1);
          if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { items: tailItem });
          else await (TestRunModel as any).updateOne(
            { _id: run._id },
            { $set: { items: tailItem } as any }
          ).catch(()=>{});
        }
      } catch (e:any) {
        const msg = String(e?.message||'');
        const st = msg==='stopped' ? 'stopped' : 'failed';
  if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { status: st, finishedAt: new Date(), error: { message: msg || 'run_failed' } });
  else await (TestRunModel as any).updateOne({ _id: run._id }, { $set: { status: st, finishedAt: new Date(), error: { message: msg || 'run_failed' } } as any });
        // Best-effort usage record on error completion
        try {
          const latest = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
          const startedAtVal = latest?.startedAt || new Date();
          const finishedAtErr = latest?.finishedAt || new Date();
          const durationSec = Math.max(0, Math.round(((finishedAtErr as any) - (startedAtVal as any)) / 1000));
          await repo.createOrUpdateUsage(String((run as any).id || run._id), {
            orgId: String((suite as any).orgId), suiteId: String((suite as any)._id || (suite as any).id), envId: body.envId || (suite as any).defaultEnvId || undefined, connectionKey: chosenConnKey,
            status: st, startedAt: startedAtVal, finishedAt: finishedAtErr, durationSec
          });
        } catch {}
      }
    })();

    return { runId: String((run as any)._id || (run as any).id), status: 'queued' } as any;
  });

  // Run a JSON test file directly without persisting suite/tests.
  // This is intended for OSS / file-mode usage and simple CI.
  app.post('/internal/run-file', async (req, reply) => {
    const body = runFileBodySchema.parse(req.body as any);
    const { statusCode, payload } = await runTestFile(body);
    return reply.code(statusCode).send(payload as any);
  });
}