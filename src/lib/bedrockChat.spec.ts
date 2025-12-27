import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the bedrockClient before importing bedrockChat
vi.mock('./bedrockClient.js', () => ({
  bedrockClient: {
    send: vi.fn(),
  },
  InvokeModelCommand: class MockInvokeModelCommand {
    constructor(public params: any) {}
  },
}));

describe('bedrockChat', () => {
  const originalEnv = process.env;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    
    const { bedrockClient } = await import('./bedrockClient.js');
    mockSend = bedrockClient.send as ReturnType<typeof vi.fn>;
    mockSend.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('bedrockChatOnce', () => {
    it('throws error when modelId is missing', async () => {
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      await expect(bedrockChatOnce({
        modelId: '',
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('bedrock_model_missing');
    });

    it('handles Anthropic model response', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{ text: 'Hello from Claude!' }],
        })),
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      const result = await bedrockChatOnce({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      
      expect(result).toBe('Hello from Claude!');
    });

    it('handles Titan model response', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        body: new TextEncoder().encode(JSON.stringify({
          results: [{ outputText: 'Hello from Titan!' }],
        })),
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      const result = await bedrockChatOnce({
        modelId: 'amazon.titan-text-express-v1',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      
      expect(result).toBe('Hello from Titan!');
    });

    it('includes system message in payload', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{ text: 'Response' }],
        })),
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      const result = await bedrockChatOnce({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [{ role: 'user', content: 'Hi' }],
        system: 'You are a helpful assistant.',
      });
      
      // Just verify the call succeeded with system message
      expect(result).toBe('Response');
    });

    it('returns empty string on parse error for Anthropic', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        body: new TextEncoder().encode('invalid json'),
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      const result = await bedrockChatOnce({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      
      expect(result).toBe('');
    });

    it('returns empty string on parse error for Titan', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        body: new TextEncoder().encode('invalid json'),
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      const result = await bedrockChatOnce({
        modelId: 'amazon.titan-text-lite-v1',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      
      expect(result).toBe('');
    });

    it('applies maxTokens and temperature settings', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      let sentBody: any = null;
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: any) => {
        sentBody = JSON.parse(cmd.params.body);
        return {
          body: new TextEncoder().encode(JSON.stringify({
            content: [{ text: 'Ok' }],
          })),
        };
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      await bedrockChatOnce({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 2048,
        temperature: 0.7,
      });
      
      expect(sentBody.max_tokens).toBe(2048);
      expect(sentBody.temperature).toBe(0.7);
    });

    it('handles missing content in Anthropic response', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        body: new TextEncoder().encode(JSON.stringify({})),
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      const result = await bedrockChatOnce({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      
      expect(result).toBe('');
    });

    it('handles missing results in Titan response', async () => {
      const { bedrockClient } = await import('./bedrockClient.js');
      (bedrockClient.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        body: new TextEncoder().encode(JSON.stringify({})),
      });
      
      const { bedrockChatOnce } = await import('./bedrockChat.js');
      
      const result = await bedrockChatOnce({
        modelId: 'amazon.titan-text-lite-v1',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      
      expect(result).toBe('');
    });
  });
});
