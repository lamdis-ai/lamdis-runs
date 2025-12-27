import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Mock cross-fetch before imports
vi.mock('cross-fetch', () => ({
  default: vi.fn(),
}));

describe('openaiClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('openaiChat', () => {
    it('throws error when OPENAI_API_KEY is not set', async () => {
      delete process.env.OPENAI_API_KEY;
      const { openaiChat } = await import('./openaiClient.js');
      
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      
      await expect(openaiChat(messages)).rejects.toThrow('OPENAI_API_KEY is not set');
    });

    it('makes request to OpenAI API when key is set', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const crossFetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      crossFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { role: 'assistant', content: 'Hello back!' } }],
        }),
      });
      
      const { openaiChat } = await import('./openaiClient.js');
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      
      const result = await openaiChat(messages);
      
      expect(crossFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-key',
          }),
        })
      );
      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].content).toBe('Hello back!');
    });

    it('uses custom model when specified', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const crossFetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      crossFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });
      
      const { openaiChat } = await import('./openaiClient.js');
      
      await openaiChat([{ role: 'user', content: 'Hi' }], { model: 'gpt-4o' });
      
      expect(crossFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('gpt-4o'),
        })
      );
    });

    it('handles API error responses', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const crossFetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      crossFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: () => Promise.resolve('Rate limited'),
      });
      
      const { openaiChat } = await import('./openaiClient.js');
      
      await expect(openaiChat([{ role: 'user', content: 'Hi' }]))
        .rejects.toThrow('OpenAI chat error: 429');
    });

    it('forces temperature=1 for o3 models', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const crossFetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      crossFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });
      
      const { openaiChat } = await import('./openaiClient.js');
      
      await openaiChat([{ role: 'user', content: 'Hi' }], { model: 'o3-mini', temperature: 0 });
      
      const callBody = JSON.parse(crossFetch.mock.calls[0][1].body);
      expect(callBody.temperature).toBe(1);
    });

    it('calculates latency correctly', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const crossFetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      crossFetch.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 50)); // Simulate delay
        return {
          ok: true,
          json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
        };
      });
      
      const { openaiChat } = await import('./openaiClient.js');
      
      const result = await openaiChat([{ role: 'user', content: 'Hi' }]);
      
      expect(result.latencyMs).toBeGreaterThanOrEqual(50);
    });
  });
});
