import { openaiChat, LLMMessage, LLMChatResult } from './openaiClient.js';
import { bedrockChatOnce } from './bedrockChat.js';

export { LLMMessage } from './openaiClient.js';

export async function runLLMConversation(messages: LLMMessage[]): Promise<LLMChatResult> {
  const provider = (process.env.LAMDIS_LLM_PROVIDER || 'openai').toLowerCase();

  if (provider === 'bedrock') {
    const modelId = process.env.LAMDIS_BEDROCK_MODEL_ID || '';
    const started = Date.now();
    const content = await bedrockChatOnce({ modelId, messages: messages as any });
    const outMessages: LLMMessage[] = [...messages, { role: 'assistant', content }];
    return { messages: outMessages, latencyMs: Date.now() - started };
  }

  // Default to OpenAI
  return openaiChat(messages);
}
