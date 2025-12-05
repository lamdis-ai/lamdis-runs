import fetch from 'cross-fetch';
import { z } from 'zod';
import { bedrockChatOnce } from '../lib/bedrockRuntime.js';

export const judgeBodySchema = z.object({
  rubric: z.string().min(1),
  threshold: z.number().optional(),
  transcript: z.array(z.any()).default([]),
  lastAssistant: z.string().optional(),
  requestNext: z.boolean().optional(),
  persona: z.string().optional(),
});

export type JudgeBody = z.infer<typeof judgeBodySchema>;

export interface JudgeResult {
  pass: boolean;
  score: number;
  threshold: number;
  reasoning: string;
  nextUser?: string;
  shouldContinue?: boolean;
  [key: string]: any;
}

export async function judgeConversation(body: JudgeBody): Promise<JudgeResult> {
  const threshold = typeof body.threshold === 'number' ? body.threshold : 0.75;
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const openaiBase = process.env.OPENAI_BASE || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const temperatureEnv = process.env.OPENAI_TEMPERATURE;
  const judgeProvider = (process.env.JUDGE_PROVIDER || '').toLowerCase();

  if (!openaiKey && judgeProvider !== 'bedrock') {
    const text = String(body.lastAssistant || JSON.stringify(body.transcript || [])).toLowerCase();
    const terms = String(body.rubric || '').toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
    const uniq = Array.from(new Set(terms)).slice(0, 20);
    const hits = uniq.filter(t => text.includes(t)).length;
    const score = uniq.length ? Math.min(1, hits / Math.max(3, Math.ceil(uniq.length * 0.3))) : 0.5;
    const pass = score >= threshold;
    return { pass, score, threshold, reasoning: 'heuristic_judge_no_openai', shouldContinue: !pass, nextUser: undefined } as any;
  }

  const sys = [
    'You are a strict evaluator for assistant conversations.',
    'Return ONLY valid JSON matching this TypeScript type:',
    '{ pass: boolean, score: number, threshold: number, reasoning: string, nextUser?: string, shouldContinue?: boolean }',
    'Score should be in [0,1]. Keep reasoning concise (<= 60 words).',
    'If requestNext is true, propose a single short, natural next user message to move closer to the goal.',
    'Do not include any extra text outside JSON.'
  ].join('\n');
  const user = JSON.stringify({
    rubric: body.rubric,
    threshold,
    persona: body.persona,
    lastAssistant: body.lastAssistant,
    transcript: body.transcript,
    requestNext: !!body.requestNext,
  });

  let out: any = undefined;

  if (judgeProvider === 'bedrock') {
    try {
      const bedrockJudgeModelId = process.env.BEDROCK_JUDGE_MODEL_ID || process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
      const bedrockJudgeTemp = process.env.BEDROCK_JUDGE_TEMPERATURE
        ? Number(process.env.BEDROCK_JUDGE_TEMPERATURE)
        : (process.env.BEDROCK_TEMPERATURE ? Number(process.env.BEDROCK_TEMPERATURE) : 0.3);
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
    } catch (e: any) {
      return { pass: false, score: 0, threshold, reasoning: `judge_error: ${e?.message || 'bedrock_failed'}` } as any;
    }
  } else {
    const payload: any = {
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    };
    if (typeof temperatureEnv === 'string' && temperatureEnv.length > 0) {
      const t = Number(temperatureEnv);
      if (!Number.isNaN(t)) {
        payload.temperature = t === 0 ? 1 : t;
      }
    }
    const resp = await fetch(`${openaiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify(payload),
    });
    const txt = await resp.text();
    if (!(resp as any).ok) {
      return { pass: false, score: 0, threshold, reasoning: `judge_error: ${txt.slice(0, 200)}` } as any;
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
}
