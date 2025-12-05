import crossFetch from 'cross-fetch';

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChatResult {
  messages: LLMMessage[];
  latencyMs: number;
}

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function deriveTemperature(model: string, requested?: number): number {
  const modelLc = String(model || '').toLowerCase();
  // Some evaluation models (including certain structured / o3 variants) only allow temperature=1.
  // For those, always force 1 to avoid invalid_request_error.
  if (modelLc.includes('o3') || modelLc.includes('structured')) return 1;
  // Otherwise, honor caller preference or fall back to 0.
  return requested ?? 0;
}

export async function openaiChat(messages: LLMMessage[], opts: LLMChatOptions = {}): Promise<LLMChatResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set for lamdis-runs');
  }

  const model = opts.model || DEFAULT_OPENAI_MODEL;
  const body = {
    model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: deriveTemperature(model, opts.temperature),
    max_tokens: opts.maxTokens,
  };

  const started = Date.now();
  const res = await crossFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI chat error: ${res.status} ${res.statusText} ${text}`);
  }

  const json: any = await res.json();
  const latencyMs = Date.now() - started;
  const choice = json.choices?.[0];
  const assistantMsg = choice?.message;

  const outMessages: LLMMessage[] = [...messages];
  if (assistantMsg && typeof assistantMsg.content === 'string') {
    outMessages.push({ role: 'assistant', content: assistantMsg.content });
  }

  return { messages: outMessages, latencyMs };
}
