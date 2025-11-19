import { bedrockClient, InvokeModelCommand } from "./bedrockClient.js";

export type ChatMessage = { role: "system"|"user"|"assistant"; content: string };

function isTitan(modelId: string): boolean {
  return /^amazon\.titan-text/i.test(modelId);
}

function buildAnthropicPayload(messages: ChatMessage[], opts: { system?: string; maxTokens?: number; temperature?: number }) {
  const systemParts = [opts.system || "", ...messages.filter(m => m.role === 'system').map(m => m.content)].filter(Boolean);
  const system = systemParts.join("\n\n").slice(0, 4000) || undefined;
  const chatMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: [{ type: 'text', text: String(m.content ?? '') }] }));
  return {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: typeof opts.maxTokens === 'number' ? opts.maxTokens : 1024,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
    ...(system ? { system } : {}),
    messages: chatMsgs,
  };
}

function buildTitanPrompt(messages: ChatMessage[], system?: string): string {
  const lines: string[] = [];
  if (system) lines.push(`System: ${system}`);
  for (const m of messages) {
    if (m.role === 'system') continue;
    const label = m.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${label}: ${m.content}`);
  }
  // Nudge the model to continue as assistant
  lines.push('Assistant:');
  return lines.join('\n');
}

export async function bedrockChatOnce(params: {
  modelId: string;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}): Promise<string> {
  const { modelId, messages, system, maxTokens, temperature, topP } = params;
  if (!modelId) throw new Error('bedrock_model_missing');

  if (isTitan(modelId)) {
    const inputText = buildTitanPrompt(messages, system);
    const body = {
      inputText,
      textGenerationConfig: {
        maxTokenCount: typeof maxTokens === 'number' ? maxTokens : 512,
        temperature: typeof temperature === 'number' ? temperature : 0.3,
        topP: typeof topP === 'number' ? topP : 0.9,
      },
    } as any;
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });
    const resp = await bedrockClient.send(command);
    const decoded = new TextDecoder().decode(resp.body as any);
    try {
      const jr = JSON.parse(decoded) as { results?: { outputText?: string }[] };
      return jr?.results?.[0]?.outputText ?? '';
    } catch {
      return '';
    }
  }

  // Default to Anthropic Messages schema
  const payload = buildAnthropicPayload(messages, { system, maxTokens, temperature });
  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });
  const resp = await bedrockClient.send(command);
  const decoded = new TextDecoder().decode(resp.body as any);
  try {
    const jr = JSON.parse(decoded) as { content?: { text?: string }[] };
    return String(jr?.content?.[0]?.text || '');
  } catch {
    return '';
  }
}
