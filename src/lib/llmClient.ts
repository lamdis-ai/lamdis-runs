import { openaiChat, LLMMessage, LLMChatResult } from './openaiClient.js';
import { bedrockChat } from './bedrockChat.js';

export { LLMMessage } from './openaiClient.js';

export async function runLLMConversation(messages: LLMMessage[]): Promise<LLMChatResult> {
  const provider = (process.env.LAMDIS_LLM_PROVIDER || 'openai').toLowerCase();

  if (provider === 'bedrock') {
    return bedrockChat(messages);
  }

  // Default to OpenAI
  return openaiChat(messages);
}
