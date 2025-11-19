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

export default async function runsRoutes(app: FastifyInstance) {
  // Local judge endpoint (OpenAI-backed) — to decouple from lamdis-api
  app.post('/orgs/:orgId/judge', async (req) => {
    const body = z.object({
      rubric: z.string().min(1),
      threshold: z.number().optional(),
      transcript: z.array(z.any()).default([]),
      lastAssistant: z.string().optional(),
      requestNext: z.boolean().optional(),
      persona: z.string().optional()
    }).parse(req.body as any);

    const threshold = typeof body.threshold === 'number' ? body.threshold : 0.75;
    const openaiKey = process.env.OPENAI_API_KEY || '';
    const openaiBase = process.env.OPENAI_BASE || 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const temperature = process.env.OPENAI_TEMPERATURE ? Number(process.env.OPENAI_TEMPERATURE) : 0;
    const judgeProvider = (process.env.JUDGE_PROVIDER || '').toLowerCase();

    // Fallback heuristic if no LLM configured
    if (!openaiKey && judgeProvider !== 'bedrock') {
      const text = String(body.lastAssistant || JSON.stringify(body.transcript || [])).toLowerCase();
      const terms = String(body.rubric || '').toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
      const uniq = Array.from(new Set(terms)).slice(0, 20);
      const hits = uniq.filter(t => text.includes(t)).length;
      const score = uniq.length ? Math.min(1, hits / Math.max(3, Math.ceil(uniq.length * 0.3))) : 0.5;
      const pass = score >= threshold;
      return { pass, score, threshold, reasoning: 'heuristic_judge_no_openai', shouldContinue: !pass, nextUser: undefined } as any;
    }

    // Ask OpenAI to evaluate and optionally propose a next user message
    const sys = [
      'You are a strict evaluator for assistant conversations.',
      'Return ONLY valid JSON matching this TypeScript type:',
      '{ pass: boolean, score: number, threshold: number, reasoning: string, nextUser?: string, shouldContinue?: boolean }',
      'Score should be in [0,1]. Keep reasoning concise (<= 60 words).',
      'If requestNext is true, propose a single short, natural next user message to move closer to the goal.',
      'Do not include any extra text outside JSON.'
    ].join('\n');
    const user = JSON.stringify({ rubric: body.rubric, threshold, persona: body.persona, lastAssistant: body.lastAssistant, transcript: body.transcript, requestNext: !!body.requestNext });

    let out: any = undefined;
    if (judgeProvider === 'bedrock') {
      try {
        // Allow distinct model/temperature for judge vs chat; fall back to legacy vars
        const bedrockJudgeModelId = process.env.BEDROCK_JUDGE_MODEL_ID || process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
        const bedrockJudgeTemp = process.env.BEDROCK_JUDGE_TEMPERATURE ? Number(process.env.BEDROCK_JUDGE_TEMPERATURE) : (process.env.BEDROCK_TEMPERATURE ? Number(process.env.BEDROCK_TEMPERATURE) : 0.3);
        const reply = await bedrockChatOnce({
          modelId: bedrockJudgeModelId,
          temperature: bedrockJudgeTemp,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
        });
        const jsonStr = String(reply || '').replace(/^```json\n?|```$/g, '').trim();
        out = JSON.parse(jsonStr);
      } catch (e:any) {
        return { pass: false, score: 0, threshold, reasoning: `judge_error: ${e?.message||'bedrock_failed'}` } as any;
      }
    } else {
      const resp = await fetch(`${openaiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model,
          temperature,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ]
        })
      });
      const txt = await resp.text();
      if (!(resp as any).ok) {
        return { pass: false, score: 0, threshold, reasoning: `judge_error: ${txt.slice(0,200)}` } as any;
      }
      try {
        const jr = JSON.parse(txt);
        const content = String(jr?.choices?.[0]?.message?.content || '').trim();
        const jsonStr = content.replace(/^```json\n?|```$/g, '').trim();
        out = JSON.parse(jsonStr);
      } catch {}
    }
    if (!out || typeof out.pass !== 'boolean') {
      return { pass: false, score: 0, threshold, reasoning: 'judge_parse_failed' } as any;
    }
    if (typeof out.threshold !== 'number') out.threshold = threshold;
    if (typeof out.score !== 'number') out.score = out.pass ? out.threshold : 0;
    return out as any;
  });
  // Helpers copied from lamdis-api (trimmed)
  const getAtPath = (obj: any, path: string): any => {
    if (!path) return undefined;
    let p = String(path).trim();
    if (p.startsWith('$.')) p = p.slice(2);
    if (p.startsWith('$')) p = p.slice(1);
    if (!p) return obj;
    const parts: (string|number)[] = [];
    let cur = '';
    for (let i=0;i<p.length;i++) {
      const ch = p[i];
      if (ch === '.') { if (cur) { parts.push(cur); cur=''; } continue; }
      if (ch === '[') {
        if (cur) { parts.push(cur); cur=''; }
        let j = i+1; let idxStr='';
        while (j < p.length && p[j] !== ']') { idxStr += p[j]; j++; }
        i = j;
        const idx = Number(idxStr);
        if (!Number.isNaN(idx)) parts.push(idx);
        continue;
      }
      cur += ch;
    }
    if (cur) parts.push(cur);
    let val = obj;
    for (const key of parts) {
      if (val == null) return undefined;
      if (typeof key === 'number') {
        if (!Array.isArray(val)) return undefined;
        val = val[key];
      } else {
        val = (val as any)[key];
      }
    }
    return val;
  };

  // Interpolate ${path} tokens in strings using a variables root object
  const interpolateString = (s: any, root: any): any => {
    if (s == null) return s;
    if (typeof s !== 'string') return s;
    return s.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      try {
        const p = String(expr || '').trim();
        const v = getAtPath(root, p);
        return v == null ? '' : String(v);
      } catch { return ''; }
    });
  };
  const interpolateDeep = (val: any, root: any): any => {
    if (val == null) return val;
    if (typeof val === 'string') return interpolateString(val, root);
    if (Array.isArray(val)) return val.map(v => interpolateDeep(v, root));
    if (typeof val === 'object') {
      const out: any = Array.isArray(val) ? [] : {};
      for (const [k,v] of Object.entries(val)) out[k] = interpolateDeep(v, root);
      return out;
    }
    return val;
  };

  // Generate a natural first user message from an objective, preferring the LLM judge endpoint
  function sanitizeInitialUserMessage(objective: string, proposed?: string): string | undefined {
    const obj = String(objective || '').replace(/^objective\s*:\s*/i, '').trim();
    const msg = String(proposed || '').trim();
    const tooLong = msg.length > 180;
    const banned = [
      /\bobjective\b/i,
      /\brubric\b/i,
      /\bsteps?\b/i,
      /\bescalat/i,
      /\bdge\b/i,
      /division of gaming/i,
      /\bnew jersey\b/i,
      /\bnj\b/i,
      /gambl/i,
      /regulat/i,
      /compliance/i,
      /policy/i,
      /finra/i,
      /sec\b/i,
      /gdpr/i,
      /hipaa/i,
      /checklist/i,
      /draft/i,
      /outline/i,
      /cite/i,
      /sources?/i,
      /official links?/i,
      /provide\b/i,
      /confirm\b/i,
      /include\b/i
    ];
    const listy = /(including|for example|e\.g\.|1\)|2\)|\-\s|:\s)/i.test(msg);
    const containsBanned = banned.some(r => r.test(msg));
    const looksMeta = containsBanned || listy || tooLong;
    if (!looksMeta && msg) return msg;
    // Build a short, end-user symptom from the objective
    let s = obj
      .replace(/\b(surface|draft|outline|provide|confirm|include|avoid|ensure|evaluate|add|comply|compliance|regulations?|policy|policies)\b[^.,;:)]*/gi, '')
      .replace(/\([^)]*\)/g, '') // remove parentheticals
      .replace(/\s+/g, ' ')
      .trim();
    // Remove regulator or policy keywords and state-specific cues
    s = s
      .replace(/\b(NJ|New Jersey) Division of Gaming Enforcement\b/gi, '')
      .replace(/\bDGE\b/gi, '')
      .replace(/\bNew Jersey\b/gi, '')
      .replace(/\bNJ\b/gi, '')
      .replace(/responsible gaming( resources)?/gi, '')
      .replace(/\b(FINRA|SEC|GDPR|HIPAA)\b/gi, '');
    if (!s || s.length > 120) s = (s || obj).split(/[.\n]/)[0].trim().slice(0, 120);
    s = s.replace(/^that\s+/i, '').replace(/^this\s+/i, '').replace(/^about\s+/i, '');

    // Heuristics to form a natural user ask
    const lc = s.toLowerCase();
    const endsPunct = /[.!?]$/.test(s);
    const startsWithI = /^(i\s|i'm\s|i am\s)/i.test(s);
    const verbish = /^(to\s+|set(\s+up)?\b|configure\b|connect\b|integrate\b|enable\b|disable\b|update\b|reset\b|change\b|cancel\b|close\b|open\b|verify\b|link\b|unlink\b|delete\b|remove\b|create\b|export\b|import\b|submit\b|file\b|pay\b|refund\b|dispute\b|troubleshoot\b|fix\b|recover\b|access\b|sign in\b|log in\b|sign up\b|register\b|upgrade\b|downgrade\b|transfer\b|withdraw\b|deposit\b|locate\b|find\b|download\b|upload\b|turn on\b|turn off\b|activate\b|deactivate\b|opt in\b|opt out\b)/i.test(s);
    let out = '';
    if (startsWithI) {
      out = s;
      if (!endsPunct) out += '.';
    } else if (verbish) {
      out = `I'm trying to ${s.replace(/^to\s+/i,'')}`;
      if (!endsPunct) out += '.';
    } else if (/^(can't|cannot|unable to)/i.test(s)) {
      out = `I'm ${s}.`;
    } else if (/^(error|issue|problem)/i.test(lc)) {
      out = `I'm having a ${s}.`;
    } else {
      out = `I need help with ${s}.`;
    }
    // Keep it short and add a polite ask
    out = out.trim();
    if (out.length > 160) out = out.slice(0, 157) + '…';
    if (!/[?]$/.test(out)) out += ' Can you help?';
    return out;
  }
  async function synthesizeInitialUserMessage(opts: {
    orgId: string;
    objective: string;
    personaText?: string;
    judgeUrl: string;
    authHeader?: string;
    log?: (e:any)=>void;
  }): Promise<string | undefined> {
    const { objective, personaText, judgeUrl, authHeader, log } = opts;
    const obj = String(objective || '').trim();
    if (!obj) return undefined;
  try {
      // Ask the judge to propose a nextUser for kickoff, using the objective as rubric-like guidance
  const rubric = `Formulate the first USER message to naturally start a conversation that will achieve this objective. The message must:
  - be phrased as an end-user speaking to the assistant (no meta-instructions, no mentions of "objective" or internal goals),
  - be a single short sentence, concise, realistic, and actionable,
  - avoid revealing internal strategies (e.g., "keep pressing"),
  - do NOT mention regulators, policies, or frameworks by name (e.g., NJ, New Jersey, DGE, SEC, FINRA, GDPR, HIPAA),
  - do NOT ask for citations or sources, and do not include bullet points.

  Objective: ${obj}`;
      const body = { rubric, threshold: 1, transcript: [], lastAssistant: 'INIT', requestNext: true, persona: personaText || '' };
      const resp = await fetch(judgeUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) }, body: JSON.stringify(body) });
      const j = await resp.json().catch(()=> ({} as any));
      const proposedRaw = typeof j?.nextUser === 'string' ? String(j.nextUser).trim() : '';
      const proposed = sanitizeInitialUserMessage(objective, proposedRaw);
      if (proposed) { log?.({ t: new Date().toISOString(), type: 'plan', content: `initial_user: ${proposed.slice(0,200)}` }); return proposed; }
    } catch (e:any) {
      log?.({ t: new Date().toISOString(), type: 'plan_error', content: `initial_user_generation_failed: ${e?.message||'error'}` });
    }
    // Heuristic fallback: convert objective into a polite ask
    const cleaned = obj
      .replace(/^objective\s*:\s*/i, '')
      .replace(/\b(keep\s+pressing|until|goal is to|your task is to|agent should|you should)\b.*$/i, '')
      .trim();
    if (cleaned) {
      const simple = sanitizeInitialUserMessage(objective, `Can you help me with this: ${cleaned}`);
      if (simple) return simple.slice(0, 200);
    }
    return undefined;
  }

  const appendQuery = (url: string, input: any): string => {
    const isAbs = /^https?:\/\//i.test(url);
    const base = isAbs ? undefined : (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`);
    const U = new URL(url, base);
    const add = (k: string, v: any) => { if (v === undefined || v === null) return; U.searchParams.set(k, String(v)); };
    if (input && typeof input === 'object') {
      for (const [k,v] of Object.entries(input)) add(k, v as any);
    }
    return U.toString();
  };

  async function executeRequest(orgId: any, requestId: string, input: any, authHeader?: string, log?: (entry: any)=>void): Promise<{ kind: 'text'|'data'; payload: any; status: number; contentType: string }>{
    const r = repo.isPg() ? await repo.getRequest(String(orgId), String(requestId)) : await (RequestModel as any).findOne({ orgId, id: requestId }).lean();
    if (!r) throw new Error(`request_not_found: ${requestId}`);
    const t = (r as any).transport || {};
    const http = t.http || {};
    const method = String(http.method || 'GET').toUpperCase();
    const url = http.full_url || ((http.base_url || '') + (http.path || ''));
    if (!url) throw new Error('request_url_missing');
    let finalUrl = url;
    const tpl = (s: string) => String(s).replace(/\{([^}]+)\}/g, (_, k) => (input && (input as any)[k] !== undefined) ? String((input as any)[k]) : `{${k}}`);
    finalUrl = tpl(finalUrl);
    let headers: Record<string,string> = {};
    if (http.headers && typeof http.headers === 'object') {
      for (const [k,v] of Object.entries(http.headers)) headers[String(k)] = tpl(String(v));
    }
    if (authHeader && !headers['Authorization']) headers['Authorization'] = authHeader;
    let body: any = undefined;
    let reqUrl = finalUrl;
    if (method === 'GET') reqUrl = appendQuery(finalUrl, input);
    else { headers['content-type'] = headers['content-type'] || 'application/json'; body = JSON.stringify(input ?? {}); }
    log?.({ t: new Date().toISOString(), type: 'request_exec', requestId, method, url: reqUrl });
    const resp = await fetch(reqUrl, { method, headers, body });
    const ct = resp.headers.get('content-type') || '';
    let payload: any = undefined;
    if (ct.includes('application/json') || ct.endsWith('+json')) payload = await resp.json().catch(()=> ({}));
    else payload = await resp.text().catch(()=> '');
    log?.({ t: new Date().toISOString(), type: 'request_result', requestId, status: resp.status, contentType: ct });
    return { kind: (typeof payload === 'string' ? 'text' : 'data'), payload, status: (resp as any).status, contentType: ct };
  }
  // Minimal auth: allow only requests from lamdis-api via a shared secret or header check
  // Option A: Shared secret header LAMDIS_API_TOKEN
  const API_TOKEN = process.env.LAMDIS_API_TOKEN || '';

  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/internal/runs')) {
      const token = (req.headers['x-api-token'] || req.headers['x-lamdis-api-token'] || req.headers['authorization']) as string | undefined;
      if (API_TOKEN && token !== API_TOKEN && token !== `Bearer ${API_TOKEN}`) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      // Optional HMAC signature verification (x-signature over `${x-timestamp}.${rawBody}`)
      const sig = (req.headers['x-signature'] as string) || '';
      const ts = (req.headers['x-timestamp'] as string) || '';
      const secret = process.env.LAMDIS_HMAC_SECRET || '';
      if (secret && sig && ts) {
        const now = Math.floor(Date.now()/1000);
        const tsv = Number(ts);
        if (!tsv || Math.abs(now - tsv) > 300) {
          return reply.code(401).send({ error: 'stale_request' });
        }
        try {
          const raw = JSON.stringify(req.body ?? {});
          const expect = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
          const ok = (()=>{
            try { return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig)); } catch { return false; }
          })();
          if (!ok) return reply.code(401).send({ error: 'bad_signature' });
        } catch {
          return reply.code(401).send({ error: 'bad_signature' });
        }
      }
    }
  });

  // Force stop a running run
  app.post('/internal/runs/:runId/stop', async (req, reply) => {
    const { runId } = z.object({ runId: z.string() }).parse(req.params as any);
    const run = repo.isPg() ? await repo.getTestRunById(String(runId)) : await (TestRunModel as any).findById(runId).lean();
    if (!run) return reply.code(404).send({ error: 'not_found' });
    if (run.status !== 'running' && run.status !== 'queued') return reply.code(400).send({ error: 'not_running' });
    // Cooperatively request stop and optimistically mark the run as stopped to handle orphaned workers
    if (repo.isPg()) await repo.updateTestRun(String(runId), { stopRequested: true, status: 'stopped', finishedAt: new Date() });
    else await (TestRunModel as any).updateOne({ _id: runId }, { $set: { stopRequested: true, status: 'stopped', finishedAt: new Date() } });
    return reply.send({ ok: true });
  });

  // Start a run (single target per call).
  app.post('/internal/runs/start', async (req) => {
    const body = z.object({
      suiteId: z.string(),
      envId: z.string().optional(),
      connKey: z.string().optional(),
      tests: z.array(z.string()).optional(),
      trigger: z.enum(['manual','schedule','ci']).default('ci'),
      gitContext: z.any().optional(),
      authHeader: z.string().optional(),
    }).parse(req.body as any);

  const suite = repo.isPg() ? await repo.getSuiteById(String(body.suiteId)) : await (TestSuiteModel as any).findById(body.suiteId);
    if (!suite) return { error: 'suite_not_found' } as any;

  // Determine the chosen connection key if any
  let chosenConnKey: string | undefined = undefined;
  if (body.connKey) chosenConnKey = body.connKey;
  // If no explicit connKey, but suite has defaultConnectionKey and no envId is provided, keep a record
  if (!chosenConnKey && !body.envId && (suite as any)?.defaultConnectionKey) chosenConnKey = String((suite as any).defaultConnectionKey);

  const run = repo.isPg()
    ? await repo.createTestRun({ orgId: String((suite as any).orgId), suiteId: String((suite as any)._id || (suite as any).id), trigger: body.trigger, envId: body.envId, connectionKey: chosenConnKey, status: 'queued', gitContext: body.gitContext })
    : await (TestRunModel as any).create({ orgId: (suite as any).orgId, suiteId: (suite as any)._id, trigger: body.trigger, envId: body.envId, connectionKey: chosenConnKey, status: 'queued', gitContext: body.gitContext });

    // Background execution (sequential)
    void (async () => {
      const startedAt = new Date();
  if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { status: 'running', startedAt, progress: { status: 'running', items: [], updatedAt: new Date().toISOString() } });
  else await (TestRunModel as any).updateOne({ _id: run._id }, { $set: { status: 'running', startedAt, progress: { status: 'running', items: [], updatedAt: new Date().toISOString() } } });
      try {
        const filter: any = { orgId: (suite as any).orgId, suiteId: (suite as any)._id };
        if (body.tests?.length) filter._id = { $in: body.tests };
        const tests = repo.isPg()
          ? await repo.getTests({ orgId: String((suite as any).orgId), suiteId: String((suite as any)._id || (suite as any).id), ids: body.tests })
          : await (TestModel as any).find(filter).lean();

        const envId = body.envId || (suite as any).defaultEnvId;
  const envDoc = envId ? (repo.isPg() ? await repo.getEnvironment(String((suite as any).orgId), String((suite as any)._id || (suite as any).id), String(envId)) : await (EnvironmentModel as any).findOne({ _id: envId, orgId: (suite as any).orgId, suiteId: (suite as any)._id }).lean()) : null;

        // Resolve connection-based environment if requested
        let connEnv: { channel: string; baseUrl?: string; headers?: any; timeoutMs?: number } | null = null;
        if (body.connKey) {
          try {
            const org = repo.isPg() ? await repo.getOrganizationById(String((suite as any).orgId)) : await (OrganizationModel as any).findById((suite as any).orgId).lean();
            const key = body.connKey;
            const conn = (org as any)?.connections?.[key];
            if (conn?.base_url) {
              connEnv = { channel: 'http_chat', baseUrl: conn.base_url, headers: undefined, timeoutMs: undefined };
            }
          } catch {}
        } else if (!envDoc && (suite as any)?.defaultConnectionKey) {
          try {
            const org = repo.isPg() ? await repo.getOrganizationById(String((suite as any).orgId)) : await (OrganizationModel as any).findById((suite as any).orgId).lean();
            const key = (suite as any).defaultConnectionKey;
            const conn = (org as any)?.connections?.[key];
            if (conn?.base_url) {
              connEnv = { channel: 'http_chat', baseUrl: conn.base_url, headers: undefined, timeoutMs: undefined };
              // Backfill connectionKey on the run if not already set
              if (!chosenConnKey) {
                chosenConnKey = String(key);
                if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { connectionKey: chosenConnKey });
                else await (TestRunModel as any).updateOne({ _id: run._id }, { $set: { connectionKey: chosenConnKey } });
              }
            }
          } catch {}
        }

  // Collect per-test results locally; we'll persist a trimmed version to avoid oversized documents
  let items: any[] = [];
        let passed = 0, failed = 0, skipped = 0;
        let judgeScores: number[] = [];

        let itemIdx = 0;
        for (const t of tests) {
          // Honor stop requests between tests
          const fresh = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
          if (fresh?.stopRequested) { throw new Error('stopped'); }
          const logs: any[] = [];
          const now = () => new Date().toISOString();
          try {
            const tScript = typeof (t as any).script === 'string' ? (yaml.load((t as any).script) as any) : (t as any).script;

            // Persona
            let personaText: string = '';
            try {
              const personaId = (t as any).personaId as string | undefined;
              if (personaId) {
                const p = repo.isPg() ? await repo.getPersona(String((suite as any).orgId), String(personaId)) : await (PersonaModel as any).findOne({ _id: personaId, orgId: (suite as any).orgId }).lean();
                personaText = (p as any)?.yaml || (p as any)?.text || '';
                if (personaText) {
                  const msgs = Array.isArray(tScript?.messages) ? tScript.messages : [];
                  tScript.messages = [{ role: 'system', content: String(personaText).slice(0, 4000) }, ...msgs];
                }
              }
            } catch {}

            const wfUrl = process.env.WORKFLOW_URL;
            const authHeader = body.authHeader || undefined;

            // Simple environments
            const environment = (connEnv || {
              channel: (envDoc?.channel || 'http_chat'),
              baseUrl: envDoc?.baseUrl,
              headers: envDoc?.headers,
              timeoutMs: envDoc?.timeoutMs,
            });

            const judgeBase = process.env.JUDGE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3101}`;
            const judgeUrl = `${judgeBase}/orgs/${(suite as any).orgId}/judge`;

            let result: any = null;
            const tAssertionsPre: any[] = Array.isArray((t as any).assertions) ? (t as any).assertions : [];
            const semA = tAssertionsPre.find((a:any)=> a && a.type==='semantic' && a.config?.rubric);
            const maxTurns = Number((t as any)?.maxTurns || 8);
            const shouldIterate = (t as any)?.iterate !== false;
            const continueAfterPass = (t as any)?.continueAfterPass === true;
            const minTurns = Math.max(1, Number((t as any)?.minTurns || 1));

            if (!wfUrl) {
              const base = (connEnv?.baseUrl || envDoc?.baseUrl);
              const chan = (connEnv?.channel || envDoc?.channel || 'http_chat');
              if (chan === 'http_chat' && base) {
                const chatUrl = `${base.replace(/\/$/, '')}/chat`;
                const msgs = Array.isArray((tScript as any)?.messages) ? (tScript as any).messages : [];
                const stepsArr: any[] = Array.isArray((t as any)?.steps) ? (t as any).steps : [];
                const hasSteps = Array.isArray(stepsArr) && stepsArr.length > 0;
                const pending: string[] = hasSteps ? [] : msgs.filter((m:any)=> String(m?.role||'').toLowerCase()==='user').map((m:any)=> String(m.content||''));
                const objective = String((t as any)?.objective || '').trim();
                // If no user message provided or it matches the raw objective, synthesize a better first message
                if (!hasSteps && (!pending.length || (objective && pending.length && String(pending[0]).trim() === objective))) {
                  const first = await synthesizeInitialUserMessage({ orgId: String((suite as any).orgId), objective, personaText, judgeUrl, authHeader, log: (e:any)=> logs.push(e) });
                  if (first && (!pending.length || String(pending[0]).trim() === objective)) {
                    if (!pending.length) pending.push(first); else pending[0] = first;
                  }
                }
                if (!hasSteps && !pending.length) throw new Error('no_user_message');
                logs.push({ t: now(), type: 'env', env: { channel: chan, baseUrl: base } });
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
                // Variable bag for steps mode
                const bag: any = { var: {}, last: { assistant: '', user: '', request: undefined }, transcript: transcriptTurns };
                let turns = 0;
                // Helper to send one user message
                const sendUser = async (userMsg: string) => {
                  const outTranscript = [...transcriptTurns, { role: 'user', content: userMsg }];
                  const payload: any = { message: String(userMsg), transcript: outTranscript };
                  if (personaText) payload.persona = String(personaText).slice(0, 4000);
                  const t0 = Date.now();
                  const resp = await fetch(chatUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) }, body: JSON.stringify(payload) });
                  if (!resp.ok) {
                    const errTxt = await resp.text().catch(()=> '')
                    throw new Error(`http_chat_failed ${resp.status}: ${errTxt || '(no body)'}`);
                  }
                  const jr = await resp.json().catch(()=>({}));
                  const rawReply = jr?.reply;
                  if (typeof rawReply !== 'string' || !rawReply.trim()) throw new Error('reply_missing');
                  const reply = rawReply;
                  const dt = Date.now() - t0; latencies.push(dt);
                  transcriptTurns.push({ role: 'user', content: userMsg });
                  transcriptTurns.push({ role: 'assistant', content: String(reply) });
                  bag.last = { assistant: String(reply), user: userMsg, request: bag.last?.request };
                  logs.push({ t: now(), type: 'assistant_reply', content: String(reply), latencyMs: dt });
                  if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { progress: { status: 'running', currentTestId: String((t as any)._id || (t as any).id), currentItem: itemIdx, lastAssistant: String(reply), lastUser: userMsg, lastLatencyMs: dt, tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } });
                  else await (TestRunModel as any).updateOne(
                    { _id: run._id },
                    { $set: { progress: { status: 'running', currentTestId: String((t as any)._id), currentItem: itemIdx, lastAssistant: String(reply), lastUser: userMsg, lastLatencyMs: dt, tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } } }
                  );
                };

                if (hasSteps) {
                  // Process steps sequentially
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
                        const exec = await executeRequest((suite as any).orgId, String(step.requestId), input, authHeader, (e:any)=> logs.push(e));
                        bag.last = { ...bag.last, request: exec.payload };
                        const key = String(step.assign || step.requestId);
                        if (key) bag.var[key] = exec.payload;
                        logs.push({ t: now(), type: 'request', stage: 'step', requestId: String(step.requestId), status: exec.status });
                      } catch (e:any) {
                        logs.push({ t: now(), type: 'request_error', stage: 'step', requestId: String(step.requestId), error: e?.message || 'exec_failed' });
                        // Continue to next step even on request error to allow soft failures
                      }
                    } else {
                      // Unknown step type: ignore
                      logs.push({ t: now(), type: 'step_skip', reason: 'unknown_type', raw: step });
                    }
                    // Honor stop between steps
                    const fresh2 = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
                    if (fresh2?.stopRequested) throw new Error('stopped');
                  }
                } else {
                  while (pending.length && turns < maxTurns) {
                  // Check stop on each turn
                  const fresh2 = repo.isPg() ? await repo.getTestRunById(String((run as any).id || run._id)) : await (TestRunModel as any).findById(run._id).lean();
                  if (fresh2?.stopRequested) throw new Error('stopped');
                  const userMsg = String(pending.shift() || '');
                  logs.push({ t: now(), type: 'user_message', content: userMsg });
                    await sendUser(userMsg);
                  turns++;

                  // ask judge for next
                  if (shouldIterate && (semA && semA.config?.rubric || (t as any)?.judgeConfig?.rubric)) {
                    try {
                      const rubric = semA?.config?.rubric || (t as any)?.judgeConfig?.rubric;
                      const threshold = semA?.config?.threshold ?? (t as any)?.judgeConfig?.threshold;
                      const lastA = String(transcriptTurns.slice().reverse().find((m:any)=>m.role==='assistant')?.content || '');
                      const judgeBody = { rubric, threshold, transcript: transcriptTurns, lastAssistant: lastA, requestNext: true, persona: personaText };
                      const judgeResp = await fetch(judgeUrl, { method:'POST', headers: { 'content-type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) }, body: JSON.stringify(judgeBody) });
                      const j = await judgeResp.json();
                      const pass = !!j?.pass;
                      const details = { score: j?.score, threshold: j?.threshold, reasoning: j?.reasoning, error: j?.error };
                      logs.push({ t: now(), type: 'judge_check', subtype: 'semantic', pass, details });
                      if (repo.isPg()) await repo.updateTestRun(String((run as any).id || run._id), { progress: { status: 'running', currentTestId: String((t as any)._id || (t as any).id), currentItem: itemIdx, lastJudge: { pass, details }, tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } });
                      else await (TestRunModel as any).updateOne(
                        { _id: run._id },
                        { $set: { progress: { status: 'running', currentTestId: String((t as any)._id), currentItem: itemIdx, lastJudge: { pass, details }, tailTranscript: transcriptTurns.slice(-8), tailLogs: logs.slice(-10), updatedAt: new Date().toISOString() } } }
                      );
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
                          const fallbackPrompts = [
                            'Can you include official links and cite your sources?',
                            'Summarize this into a step-by-step checklist with exact menu paths the user should click.',
                            'Provide copy-paste templates and concrete examples tailored to my case.',
                            'Verify coverage and call out constraints, edge cases, and any timing or policy rules.',
                            'Give me next steps as a short plan with owners and deadlines.'
                          ];
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
                result = { status: 'passed', transcript: transcriptTurns, messageCounts: msgCounts, assertions: [], confirmations: [], timings: stats };
              } else if (chan === 'openai_chat') {
                // OpenAI chat directly. Persona as system, iterate with judge.
                const org = repo.isPg() ? await repo.getOrganizationById(String((suite as any).orgId)) : await (OrganizationModel as any).findById((suite as any).orgId).lean();
                const enc = (org as any)?.integrations?.openai;
                let apiKey: string | undefined; try { const d = decrypt(enc); apiKey = d?.apiKey; } catch {}
                if (!apiKey && process.env.OPENAI_API_KEY) apiKey = process.env.OPENAI_API_KEY;
                if (!apiKey) throw new Error('openai_missing');
                const openaiBase = process.env.OPENAI_BASE || 'https://api.openai.com/v1';
                const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
                const temperature = process.env.OPENAI_TEMPERATURE ? Number(process.env.OPENAI_TEMPERATURE) : 1;
                const msgs = Array.isArray((tScript as any)?.messages) ? (tScript as any).messages : [];
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
                logs.push({ t: now(), type: 'env', env: { channel: chan } });
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
                  const resp = await fetch(`${openaiBase}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, temperature, messages: chatMessages })
                  });
                  const jrTxt = await resp.text();
                  if (!(resp as any).ok) throw new Error(`openai_error: ${jrTxt}`);
                  let reply: string | undefined;
                  try {
                    const jr = JSON.parse(jrTxt);
                    reply = typeof jr?.choices?.[0]?.message?.content === 'string' ? jr.choices[0].message.content : undefined;
                  } catch {}
                  if (!reply || !reply.trim()) throw new Error('reply_missing');
                  const dt = Date.now() - t0; latencies.push(dt);
                  transcriptTurns.push({ role: 'assistant', content: reply });
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
            const combinedAssertions = Array.isArray(result.assertions) ? [...result.assertions, ...extraAssertions] : extraAssertions;
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
              items.push({ testId: String((t as any)._id), status: 'failed', error: { message: e?.message || 'exec_failed' } });
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
          return {
            testId: String(it.testId),
            status: String(it.status),
            transcript,
            ...(messageCounts ? { messageCounts } : {}),
            assertions: Array.isArray(it.assertions) ? it.assertions : [],
            confirmations: Array.isArray(it.confirmations) ? it.confirmations : [],
            timings: it.timings,
            error: it.error,
            artifacts: { log: logs }
          };
        };
        const trimmedItems = Array.isArray(items) ? items.map(trimItem) : [];
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
}
