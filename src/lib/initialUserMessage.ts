import fetch from 'cross-fetch';

export function sanitizeInitialUserMessage(objective: string, proposed?: string): string | undefined {
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

  let s = obj
    .replace(/\b(surface|draft|outline|provide|confirm|include|avoid|ensure|evaluate|add|comply|compliance|regulations?|policy|policies)\b[^.,;:)]*/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  s = s
    .replace(/\b(NJ|New Jersey) Division of Gaming Enforcement\b/gi, '')
    .replace(/\bDGE\b/gi, '')
    .replace(/\bNew Jersey\b/gi, '')
    .replace(/\bNJ\b/gi, '')
    .replace(/responsible gaming( resources)?/gi, '')
    .replace(/\b(FINRA|SEC|GDPR|HIPAA)\b/gi, '');

  if (!s || s.length > 120) s = (s || obj).split(/[.\n]/)[0].trim().slice(0, 120);
  s = s.replace(/^that\s+/i, '').replace(/^this\s+/i, '').replace(/^about\s+/i, '');

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

  out = out.trim();
  if (out.length > 160) out = out.slice(0, 157) + '…';
  if (!/[?]$/.test(out)) out += ' Can you help?';
  return out;
}

export async function synthesizeInitialUserMessage(opts: {
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
