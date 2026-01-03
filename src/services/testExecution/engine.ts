import fetch from 'cross-fetch';
import { interpolateDeep, interpolateString } from '../../lib/interpolation.js';
import { synthesizeInitialUserMessage } from '../../lib/initialUserMessage.js';
import { extractFromConversation } from '../extractionService.js';

export type EngineEnvironment = {
  channel: string;
  baseUrl?: string;
  headers?: Record<string, any>;
  timeoutMs?: number;
};

export type EngineTest = {
  _id: string;
  name?: string;
  orgId: string;
  suiteId: string;
  script: any;
  personaText?: string;
  steps?: any[];
  objective?: string;
  maxTurns?: number;
  iterate?: boolean;
  continueAfterPass?: boolean;
  minTurns?: number;
  judgeConfig?: { rubric?: string; threshold?: number };
};

export type EngineContext = {
  orgId: string;
  judgeUrl: string;
  wfUrl?: string;
  authHeader?: string;
  environment: EngineEnvironment;
};

export type EngineRunHooks = {
  executeRequest?: (
    orgId: string,
    requestId: string,
    input: any,
  ) => Promise<{ status: string; payload: any }>;
  log?: (entry: any) => void;
};

export type EngineItemResult = {
  testId: string;
  testName?: string;
  status: string;
  transcript: any[];
  messageCounts: { user: number; assistant: number; total: number };
  assertions: any[];
  confirmations: any[];
  timings: any;
  error?: any;
  artifacts?: { log?: any[] };
};

export type EngineRunResult = {
  items: EngineItemResult[];
  passed: number;
  failed: number;
  skipped: number;
  judgeScores: number[];
};

const defaultFallbackPrompts = [
  'Can you share the official page or link where I can do this?',
  'Could you give me simple step-by-step instructions with where to click?',
  'Can you show me a concrete example I could reuse?',
  'Are there any limits, timing rules, or gotchas I should know about?',
  'What are my next steps from here?'
];

export async function runTestsWithEngine(
  tests: EngineTest[],
  ctx: EngineContext,
  hooks: EngineRunHooks = {},
): Promise<EngineRunResult> {
  const wfUrl = ctx.wfUrl;
  const authHeader = ctx.authHeader;
  const judgeUrl = ctx.judgeUrl;

  const items: EngineItemResult[] = [];
  let passed = 0, failed = 0, skipped = 0;
  const judgeScores: number[] = [];

  const now = () => new Date().toISOString();

  for (const t of tests) {
    const logs: any[] = [];
    const log = (e: any) => {
      logs.push(e);
      hooks.log?.(e);
    };
    try {
      const tScript = typeof (t as any).script === 'string'
        ? (require('js-yaml') as any).load((t as any).script)
        : (t as any).script;

      const personaText = t.personaText || '';
      const environment = ctx.environment;

      let result: any = null;
      const maxTurns = Number((t as any)?.maxTurns || 8);
      const shouldIterate = (t as any)?.iterate !== false;
      const continueAfterPass = (t as any)?.continueAfterPass === true;
      const minTurns = Math.max(1, Number((t as any)?.minTurns || 1));

      if (!wfUrl) {
        const base = environment.baseUrl;
        const chan = environment.channel || 'http_chat';
        if (chan === 'http_chat' && base) {
          const chatUrl = `${base.replace(/\/$/, '')}/chat`;
          const msgs = Array.isArray((tScript as any)?.messages) ? (tScript as any).messages : [];
          const stepsArr: any[] = Array.isArray((t as any)?.steps) ? (t as any).steps : [];
          const hasSteps = Array.isArray(stepsArr) && stepsArr.length > 0;
          const pending: string[] = hasSteps
            ? []
            : msgs
                .filter((m: any) => String(m?.role || '').toLowerCase() === 'user')
                .map((m: any) => String(m.content || ''));
          const objective = String((t as any)?.objective || '').trim();
          if (!hasSteps && (!pending.length || (objective && pending.length && String(pending[0]).trim() === objective))) {
            const first = await synthesizeInitialUserMessage({
              orgId: String(t.orgId),
              objective,
              personaText,
              judgeUrl,
              authHeader,
              log,
            });
            if (first && (!pending.length || String(pending[0]).trim() === objective)) {
              if (!pending.length) pending.push(first);
              else pending[0] = first;
            }
          }
          if (!hasSteps && !pending.length) throw new Error('no_user_message');
          log({ t: now(), type: 'env', env: { channel: chan, baseUrl: base } });

          const transcriptTurns: any[] = [];
          const latencies: number[] = [];
          let fallbackIdx = 0;
          const bag: any = {
            var: {},
            steps: {}, // Store outputs by step ID for $steps.step_id.output syntax
            last: { assistant: '', user: '', request: undefined },
            transcript: transcriptTurns,
          };
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
            const resp = await fetch(chatUrl, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(authHeader ? { Authorization: authHeader } : {}),
              },
              body: JSON.stringify(payload),
            });
            if (!resp.ok) {
              const errTxt = await resp.text().catch(() => '');
              throw new Error(`http_chat_failed ${resp.status}: ${errTxt || '(no body)'}`);
            }
            const jr = await resp.json().catch(() => ({}));
            const rawReply = jr?.reply;
            if (typeof rawReply !== 'string' || !rawReply.trim()) throw new Error('reply_missing');
            const replyTxt = rawReply;
            const dt = Date.now() - t0;
            latencies.push(dt);
            transcriptTurns.push({ role: 'user', content: userMsg });
            transcriptTurns.push({ role: 'assistant', content: String(replyTxt) });
            bag.last = { assistant: String(replyTxt), user: userMsg, request: bag.last?.request };
            log({ t: now(), type: 'assistant_reply', content: String(replyTxt), latencyMs: dt, transcript: [...transcriptTurns] });
          };

          if (hasSteps) {
            for (let stepIdx = 0; stepIdx < stepsArr.length; stepIdx++) {
              const rawStep = stepsArr[stepIdx];
              const step = rawStep || {};
              const type = String(step.type || '').toLowerCase();
              if (type === 'message') {
                const role = String(step.role || 'user').toLowerCase();
                const contentTpl = step.content;
                const root = {
                  ...bag,
                  lastAssistant: bag?.last?.assistant,
                  lastUser: bag?.last?.user,
                };
                const content = interpolateString(String(contentTpl || ''), root);
                if (role === 'system') {
                  transcriptTurns.push({ role: 'system', content });
                  log({ t: now(), type: 'system_message', content });
                } else {
                  log({ t: now(), type: 'user_message', content });
                  await sendUser(content);
                  turns++;
                  if (turns >= maxTurns) break;
                }
              } else if (type === 'request' && step.requestId && hooks.executeRequest) {
                const root = {
                  ...bag,
                  lastAssistant: bag?.last?.assistant,
                  lastUser: bag?.last?.user,
                };
                // Support both step.input (legacy) and step.inputMappings (UI builder)
                const inputSource = step.inputMappings ?? step.input ?? {};
                const input = interpolateDeep(inputSource, root);
                try {
                  const exec = await hooks.executeRequest(t.orgId, String(step.requestId), input);
                  bag.last = { ...bag.last, request: exec.payload };
                  const key = String(step.saveAs || step.assign || step.requestId);
                  if (key) bag.var[key] = exec.payload;
                  // Also store by step ID for $steps.step_id.output syntax
                  const stepId = String(step.id || '');
                  if (stepId) {
                    bag.steps[stepId] = { output: exec.payload, status: exec.status };
                  }
                  log({
                    t: now(),
                    type: 'request',
                    stage: 'step',
                    requestId: String(step.requestId),
                    status: exec.status,
                  });
                } catch (e: any) {
                  log({
                    t: now(),
                    type: 'request_error',
                    stage: 'step',
                    requestId: String(step.requestId),
                    error: e?.message || 'exec_failed',
                  });
                }
              } else if (type === 'assistant_check') {
                const mode = String((step as any).mode || 'judge');
                if (mode === 'judge') {
                  const rubric = String((step as any).rubric || '').trim();
                  if (!rubric) {
                    log({
                      t: now(),
                      type: 'step_skip',
                      subtype: 'assistant_check_judge',
                      reason: 'missing_rubric',
                      step,
                    });
                  } else {
                    try {
                      const scope = (step as any).scope || 'last';
                      const stepName = (step as any).name || '';
                      const lastAssistant = String(
                        transcriptTurns
                          .slice()
                          .reverse()
                          .find((m: any) => m.role === 'assistant')?.content || '',
                      );
                      const judgeBody = {
                        rubric,
                        threshold: (step as any).threshold,
                        transcript: transcriptTurns,
                        lastAssistant,
                        scope,
                      };
                      const judgeResp = await fetch(judgeUrl, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(judgeBody),
                      });
                      const j = await judgeResp.json().catch(() => ({}));
                      const pass = !!j?.pass;
                      const details = {
                        score: j?.score,
                        threshold: j?.threshold,
                        reasoning: j?.reasoning,
                        rubric,
                        stepName,
                        error: j?.error,
                      };
                      log({
                        t: now(),
                        type: 'judge_check',
                        subtype: 'assistant_check_judge',
                        stepIndex: stepIdx,
                        stepName,
                        pass,
                        details,
                      });
                      const stepAssertion = {
                        type: 'assistant_check',
                        subtype: 'judge',
                        pass,
                        details,
                        config: { rubric, scope, threshold: (step as any).threshold },
                        stepId: (step as any).id,
                        name: stepName,
                        severity: (step as any).severity || 'error',
                      };
                      result.assertions = Array.isArray(result.assertions)
                        ? [...result.assertions, stepAssertion]
                        : [stepAssertion];
                    } catch (e: any) {
                      const stepName = (step as any).name || '';
                      const details = { error: e?.message || 'judge_failed', rubric, stepName };
                      log({
                        t: now(),
                        type: 'step_error',
                        subtype: 'assistant_check_judge',
                        message: details.error,
                        step,
                      });
                      const stepAssertion = {
                        type: 'assistant_check',
                        subtype: 'judge',
                        pass: false,
                        details,
                        config: { rubric, scope: (step as any).scope || 'last', threshold: (step as any).threshold },
                        stepId: (step as any).id,
                        name: stepName,
                        severity: (step as any).severity || 'error',
                      };
                      result.assertions = Array.isArray(result.assertions)
                        ? [...result.assertions, stepAssertion]
                        : [stepAssertion];
                    }
                  }
                } else {
                  log({
                    t: now(),
                    type: 'step_skip',
                    subtype: 'assistant_check',
                    reason: 'unknown_mode',
                    step,
                  });
                }
              } else if (type === 'extract') {
                // Extract step: uses LLM to extract structured data from the conversation
                const variableName = String((step as any).variableName || '').trim();
                const description = String((step as any).description || '').trim();
                const scope = String((step as any).scope || 'last') as 'last' | 'transcript';
                
                if (!variableName) {
                  log({
                    t: now(),
                    type: 'step_skip',
                    subtype: 'extract',
                    reason: 'missing_variable_name',
                    step,
                  });
                } else if (!description) {
                  log({
                    t: now(),
                    type: 'step_skip',
                    subtype: 'extract',
                    reason: 'missing_description',
                    step,
                  });
                } else {
                  try {
                    const lastAssistant = String(
                      transcriptTurns
                        .slice()
                        .reverse()
                        .find((m: any) => m.role === 'assistant')?.content || '',
                    );
                    
                    const extractResult = await extractFromConversation({
                      variableName,
                      description,
                      scope,
                      lastAssistant,
                      transcript: transcriptTurns,
                    });
                    
                    // Store extracted value in the bag
                    if (extractResult.success && extractResult.value !== null && extractResult.value !== undefined) {
                      bag.var[variableName] = extractResult.value;
                      // Also store by step ID if provided
                      const stepId = String(step.id || '');
                      if (stepId) {
                        bag.steps[stepId] = { output: extractResult.value, success: true };
                      }
                    }
                    
                    log({
                      t: now(),
                      type: 'extract',
                      variableName,
                      description,
                      scope,
                      success: extractResult.success,
                      value: extractResult.value,
                      reasoning: extractResult.reasoning,
                      error: extractResult.error,
                    });
                  } catch (e: any) {
                    log({
                      t: now(),
                      type: 'step_error',
                      subtype: 'extract',
                      variableName,
                      message: e?.message || 'extract_failed',
                      step,
                    });
                  }
                }
              } else {
                log({ t: now(), type: 'step_skip', reason: 'unknown_type', raw: step });
              }
            }
          } else {
            while (pending.length && turns < maxTurns) {
              const userMsg = String(pending.shift() || '');
              log({ t: now(), type: 'user_message', content: userMsg });
              await sendUser(userMsg);
              turns++;

              if (shouldIterate && t.judgeConfig?.rubric) {
                try {
                  const rubric = t.judgeConfig?.rubric;
                  const threshold = t.judgeConfig?.threshold;
                  const lastA = String(
                    transcriptTurns
                      .slice()
                      .reverse()
                      .find((m: any) => m.role === 'assistant')?.content || '',
                  );
                  const judgeBody = {
                    rubric,
                    threshold,
                    transcript: transcriptTurns,
                    lastAssistant: lastA,
                    requestNext: true,
                    persona: personaText,
                  };
                  const judgeResp = await fetch(judgeUrl, {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      ...(authHeader ? { Authorization: authHeader } : {}),
                    },
                    body: JSON.stringify(judgeBody),
                  });
                  const j = await judgeResp.json();
                  const pass = !!j?.pass;
                  const details = {
                    score: j?.score,
                    threshold: j?.threshold,
                    reasoning: j?.reasoning,
                    rubric,
                    error: j?.error,
                  };
                  log({ t: now(), type: 'judge_check', subtype: 'semantic', pass, details });
                  const haveMinTurns = turns >= minTurns;
                  const nextUserRaw = typeof j?.nextUser === 'string' ? j.nextUser : '';
                  const shouldContinue = j?.shouldContinue !== false;
                  let willBreak = false;
                  if (pass) {
                    if (!continueAfterPass && haveMinTurns) {
                      willBreak = true;
                    } else {
                      log({
                        t: now(),
                        type: 'judge_decision',
                        content: `pass but continuing (minTurns=${minTurns}, continueAfterPass=${continueAfterPass})`,
                      });
                    }
                  }
                  if (willBreak) break;
                  if (shouldContinue && turns < maxTurns) {
                    let nextUser = nextUserRaw;
                    if (!nextUser) {
                      const lastUserPrev =
                        transcriptTurns
                          .slice()
                          .reverse()
                          .find((m: any) => m.role === 'user')?.content || '';
                      for (let k = 0; k < defaultFallbackPrompts.length; k++) {
                        const idx = (fallbackIdx + k) % defaultFallbackPrompts.length;
                        const cand = defaultFallbackPrompts[idx];
                        if (
                          String(cand).trim().toLowerCase() !==
                          String(lastUserPrev).trim().toLowerCase()
                        ) {
                          nextUser = cand;
                          fallbackIdx = (idx + 1) % defaultFallbackPrompts.length;
                          break;
                        }
                      }
                      nextUser = nextUser || defaultFallbackPrompts[0];
                    }
                    if (nextUser) {
                      const lastUserPrev =
                        transcriptTurns
                          .slice()
                          .reverse()
                          .find((m: any) => m.role === 'user')?.content || '';
                      if (
                        String(nextUser).trim().toLowerCase() !==
                        String(lastUserPrev).trim().toLowerCase()
                      ) {
                        pending.push(String(nextUser));
                        log({
                          t: now(),
                          type: 'plan',
                          content: `next_user: ${String(nextUser).slice(0, 200)}`,
                        });
                      } else {
                        log({
                          t: now(),
                          type: 'plan_skip',
                          content: 'skipped duplicate follow-up',
                        });
                        break;
                      }
                    } else {
                      break;
                    }
                  }
                } catch (e: any) {
                  log({
                    t: now(),
                    type: 'judge_check',
                    subtype: 'semantic',
                    pass: false,
                    details: { error: e?.message || 'judge_failed' },
                  });
                }
              }
            }
          }

          const stats = (() => {
            const arr = latencies.slice().sort((a, b) => a - b);
            const pick = (p: number) =>
              arr.length
                ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))]
                : undefined;
            const avg = arr.length
              ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
              : undefined;
            return {
              // These are assistant endpoint latencies (time to get response from the target being tested)
              source: 'assistant' as const,
              label: 'Assistant Response Time',
              perTurnMs: latencies,
              avgMs: avg,
              p50Ms: pick(0.5),
              p95Ms: pick(0.95),
              maxMs: arr.length ? arr[arr.length - 1] : undefined,
            };
          })();
          const msgCounts = {
            user: transcriptTurns.filter((m) => m.role === 'user').length,
            assistant: transcriptTurns.filter((m) => m.role === 'assistant').length,
            total: transcriptTurns.length,
          };
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
        const r = await fetch(`${wfUrl}/testing/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            script: tScript,
            environment,
            variables: {},
            judge: { url: judgeUrl, orgId: String(t.orgId) },
          }),
        });
        result = await r.json();
      }

      const item: EngineItemResult = {
        testId: String(t._id),
        testName: t.name || undefined,
        status: result?.status || 'failed',
        transcript: result.transcript || [],
        messageCounts: result.messageCounts || { user: 0, assistant: 0, total: 0 },
        assertions: Array.isArray(result.assertions) ? result.assertions : [],
        confirmations: Array.isArray(result.confirmations) ? result.confirmations : [],
        timings: result.timings || {},
        error: result.error,
        artifacts: { log: logs },
      };

      items.push(item);
      if (item.status === 'passed') passed++;
      else failed++;
    } catch (e: any) {
      const cleanMsg = e?.message || 'exec_failed';
      items.push({
        testId: String(t._id),
        testName: t.name || undefined,
        status: 'failed',
        transcript: [],
        messageCounts: { user: 0, assistant: 0, total: 0 },
        assertions: [],
        confirmations: [],
        timings: {},
        error: { message: cleanMsg },
      });
      failed++;
    }
  }

  return { items, passed, failed, skipped, judgeScores };
}
