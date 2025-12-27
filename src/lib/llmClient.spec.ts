import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('llmClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('runLLMConversation', () => {
    it('uses OpenAI by default', async () => {
      delete process.env.LAMDIS_LLM_PROVIDER;
      
      // Mock the openaiChat function
      const mockOpenaiChat = vi.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        latencyMs: 100,
      });
      
      vi.doMock('./openaiClient.js', () => ({
        openaiChat: mockOpenaiChat,
        LLMMessage: {},
      }));
      
      vi.doMock('./bedrockChat.js', () => ({
        bedrockChatOnce: vi.fn(),
      }));
      
      const { runLLMConversation } = await import('./llmClient.js');
      
      const result = await runLLMConversation([{ role: 'user', content: 'Hello' }]);
      
      expect(mockOpenaiChat).toHaveBeenCalled();
      expect(result.messages).toHaveLength(2);
    });

    it('uses Bedrock when LAMDIS_LLM_PROVIDER is bedrock', async () => {
      process.env.LAMDIS_LLM_PROVIDER = 'bedrock';
      process.env.LAMDIS_BEDROCK_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
      
      const mockBedrockChat = vi.fn().mockResolvedValue('Bedrock response');
      
      vi.doMock('./bedrockChat.js', () => ({
        bedrockChatOnce: mockBedrockChat,
      }));
      
      vi.doMock('./openaiClient.js', () => ({
        openaiChat: vi.fn(),
        LLMMessage: {},
      }));
      
      const { runLLMConversation } = await import('./llmClient.js');
      
      const result = await runLLMConversation([{ role: 'user', content: 'Hello' }]);
      
      expect(mockBedrockChat).toHaveBeenCalledWith(expect.objectContaining({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      }));
      expect(result.messages[result.messages.length - 1].content).toBe('Bedrock response');
    });

    it('handles case-insensitive provider name', async () => {
      process.env.LAMDIS_LLM_PROVIDER = 'BEDROCK';
      process.env.LAMDIS_BEDROCK_MODEL_ID = 'test-model';
      
      const mockBedrockChat = vi.fn().mockResolvedValue('response');
      
      vi.doMock('./bedrockChat.js', () => ({
        bedrockChatOnce: mockBedrockChat,
      }));
      
      vi.doMock('./openaiClient.js', () => ({
        openaiChat: vi.fn(),
        LLMMessage: {},
      }));
      
      const { runLLMConversation } = await import('./llmClient.js');
      
      await runLLMConversation([{ role: 'user', content: 'Hello' }]);
      
      expect(mockBedrockChat).toHaveBeenCalled();
    });
  });
});
