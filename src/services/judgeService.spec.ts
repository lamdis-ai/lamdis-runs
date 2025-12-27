import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { judgeBodySchema, judgeConversation } from './judgeService.js';

// Mock cross-fetch
vi.mock('cross-fetch', () => ({
  default: vi.fn(),
}));

// Mock bedrockChatOnce
vi.mock('../lib/bedrockRuntime.js', () => ({
  bedrockChatOnce: vi.fn(),
}));

describe('judgeService', () => {
  describe('judgeBodySchema', () => {
    it('validates minimal valid body', () => {
      const body = { rubric: 'Test rubric' };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    it('rejects empty rubric', () => {
      const body = { rubric: '' };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('rejects missing rubric', () => {
      const body = { threshold: 0.8 };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(false);
    });

    it('accepts full body with all optional fields', () => {
      const body = {
        rubric: 'Test rubric',
        threshold: 0.8,
        transcript: [{ role: 'user', content: 'hello' }],
        lastAssistant: 'Hello! How can I help?',
        requestNext: true,
        persona: 'friendly customer',
      };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.threshold).toBe(0.8);
        expect(result.data.requestNext).toBe(true);
      }
    });

    it('defaults transcript to empty array', () => {
      const body = { rubric: 'Test' };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transcript).toEqual([]);
      }
    });

    it('accepts scope parameter', () => {
      const body = { rubric: 'Test', scope: 'transcript' };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe('transcript');
      }
    });

    it('defaults scope to last', () => {
      const body = { rubric: 'Test' };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe('last');
      }
    });

    it('rejects invalid scope values', () => {
      const body = { rubric: 'Test', scope: 'invalid' };
      const result = judgeBodySchema.safeParse(body);
      expect(result.success).toBe(false);
    });
  });

  describe('judgeConversation', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
      // Clear OpenAI key to force heuristic mode
      delete process.env.OPENAI_API_KEY;
      delete process.env.JUDGE_PROVIDER;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('uses heuristic judge when no OpenAI key is set', async () => {
      const body = {
        rubric: 'The assistant should mention account and password',
        threshold: 0.5,
        transcript: [],
        lastAssistant: 'To reset your account password, click on the forgot password link.',
      };
      
      const result = await judgeConversation(body);
      
      expect(result).toBeDefined();
      expect(result.reasoning).toBe('heuristic_judge_no_openai');
      expect(typeof result.pass).toBe('boolean');
      expect(typeof result.score).toBe('number');
      expect(result.threshold).toBe(0.5);
    });

    it('heuristic judge passes when enough terms match', async () => {
      const body = {
        rubric: 'account password reset',
        threshold: 0.3,
        transcript: [],
        lastAssistant: 'Your account password has been reset successfully.',
      };
      
      const result = await judgeConversation(body);
      
      expect(result.pass).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    it('heuristic judge fails when few terms match', async () => {
      const body = {
        rubric: 'billing invoice payment refund',
        threshold: 0.8,
        transcript: [],
        lastAssistant: 'Hello, how can I help you today?',
      };
      
      const result = await judgeConversation(body);
      
      expect(result.pass).toBe(false);
    });

    it('uses default threshold of 0.75 when not provided', async () => {
      const body = {
        rubric: 'test rubric',
        transcript: [],
        lastAssistant: 'test response',
      };
      
      const result = await judgeConversation(body);
      
      expect(result.threshold).toBe(0.75);
    });

    it('heuristic sets shouldContinue based on pass status', async () => {
      const failBody = {
        rubric: 'specific unique terminology xyz',
        threshold: 0.9,
        transcript: [],
        lastAssistant: 'Generic response without the terms.',
      };
      
      const result = await judgeConversation(failBody);
      
      expect(result.shouldContinue).toBe(!result.pass);
    });

    it('handles empty last assistant message', async () => {
      const body = {
        rubric: 'test rubric',
        transcript: [{ role: 'user', content: 'hello' }],
        lastAssistant: '',
      };
      
      const result = await judgeConversation(body);
      
      expect(result).toBeDefined();
    });

    it('handles transcript array in rubric matching', async () => {
      const body = {
        rubric: 'password reset account',
        threshold: 0.3,
        transcript: [
          { role: 'user', content: 'I need to reset my password' },
          { role: 'assistant', content: 'I can help with your account password reset.' },
        ],
      };
      
      const result = await judgeConversation(body);
      
      expect(result).toBeDefined();
    });

    it('handles case-insensitive rubric matching', async () => {
      const body = {
        rubric: 'PASSWORD RESET',
        threshold: 0.3,
        transcript: [],
        lastAssistant: 'password has been reset',
      };
      
      const result = await judgeConversation(body);
      
      expect(result.pass).toBe(true);
    });

    it('handles very long lastAssistant messages', async () => {
      const body = {
        rubric: 'help support',
        threshold: 0.3,
        transcript: [],
        lastAssistant: 'I am here to help you with your support request. '.repeat(100),
      };
      
      const result = await judgeConversation(body);
      
      expect(result).toBeDefined();
      expect(result.pass).toBe(true);
    });

    it('handles rubric with no matching terms', async () => {
      const body = {
        rubric: 'xyzabc unique specific',
        threshold: 0.5,
        transcript: [],
        lastAssistant: 'Hello, how may I assist you today?',
      };
      
      const result = await judgeConversation(body);
      
      expect(result.pass).toBe(false);
      expect(result.score).toBe(0);
    });

    it('handles single word rubric', async () => {
      const body = {
        rubric: 'password',
        threshold: 0.3, // With the formula (1 hit / max(3, ceil(1*0.3))) = 1/3 = 0.33
        transcript: [],
        lastAssistant: 'Your password has been updated.',
      };
      
      const result = await judgeConversation(body);
      
      expect(result.pass).toBe(true);
      // Score = 1 hit / max(3, ceil(0.3)) = 1/3 ≈ 0.33
      expect(result.score).toBeGreaterThan(0.3);
    });

    it('handles many terms in rubric', async () => {
      const body = {
        rubric: 'password reset account login security authentication',
        threshold: 0.5,
        transcript: [],
        lastAssistant: 'I can help you reset your account password.',
      };
      
      const result = await judgeConversation(body);
      
      expect(result).toBeDefined();
      // Should have some matches: password, reset, account
      expect(result.score).toBeGreaterThan(0);
    });

    it('evaluates only lastAssistant when scope is "last"', async () => {
      const body = {
        rubric: 'password reset',
        threshold: 0.3,
        transcript: [
          { role: 'user', content: 'I forgot my password' },
          { role: 'assistant', content: 'I can help you reset your password right away.' },
        ],
        lastAssistant: 'Thank you for contacting us!', // No password/reset keywords
        scope: 'last' as const,
      };
      
      const result = await judgeConversation(body);
      
      // Should fail because lastAssistant doesn't contain the keywords
      expect(result.pass).toBe(false);
    });

    it('evaluates entire transcript when scope is "transcript"', async () => {
      const body = {
        rubric: 'password reset',
        threshold: 0.3,
        transcript: [
          { role: 'user', content: 'I forgot my password' },
          { role: 'assistant', content: 'I can help you reset your password right away.' },
        ],
        lastAssistant: 'Thank you for contacting us!', // No password/reset keywords
        scope: 'transcript' as const,
      };
      
      const result = await judgeConversation(body);
      
      // Should pass because transcript contains the keywords
      expect(result.pass).toBe(true);
    });

    it('defaults to scope "last" when not specified', async () => {
      const body = {
        rubric: 'billing payment',
        threshold: 0.3,
        transcript: [
          { role: 'assistant', content: 'Your billing and payment details have been updated.' },
        ],
        lastAssistant: 'Is there anything else I can help you with?',
        // No scope specified - should default to 'last'
      };
      
      const result = await judgeConversation(body);
      
      // Should fail because lastAssistant doesn't contain billing/payment
      expect(result.pass).toBe(false);
    });
  });

  describe('judgeConversation with OpenAI', () => {
    const originalEnv = process.env;

    beforeEach(async () => {
      vi.resetModules();
      process.env = { ...originalEnv };
      process.env.OPENAI_API_KEY = 'test-api-key';
      delete process.env.JUDGE_PROVIDER;
      vi.clearAllMocks();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('calls OpenAI API and returns parsed result', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                pass: true,
                score: 0.9,
                threshold: 0.75,
                reasoning: 'Good response',
              }),
            },
          }],
        })),
      });

      const body = {
        rubric: 'Test rubric',
        transcript: [],
        lastAssistant: 'Test response',
      };

      const result = await judgeConversation(body);

      expect(fetch).toHaveBeenCalled();
      expect(result.pass).toBe(true);
      expect(result.score).toBe(0.9);
      expect(result.reasoning).toBe('Good response');
    });

    it('returns error on API failure', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      const body = {
        rubric: 'Test rubric',
        transcript: [],
        lastAssistant: 'Test response',
      };

      const result = await judgeConversation(body);

      expect(result.pass).toBe(false);
      expect(result.reasoning).toContain('judge_error');
    });

    it('returns parse failed on invalid JSON', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{
            message: {
              content: 'Not valid JSON at all',
            },
          }],
        })),
      });

      const body = {
        rubric: 'Test rubric',
        transcript: [],
        lastAssistant: 'Test response',
      };

      const result = await judgeConversation(body);

      expect(result.pass).toBe(false);
      expect(result.reasoning).toBe('judge_parse_failed');
    });

    it('handles JSON wrapped in markdown code blocks', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{
            message: {
              content: '```json\n{"pass": true, "score": 0.85, "reasoning": "Good"}\n```',
            },
          }],
        })),
      });

      const body = {
        rubric: 'Test rubric',
        transcript: [],
        lastAssistant: 'Test response',
      };

      const result = await judgeConversation(body);

      expect(result.pass).toBe(true);
      expect(result.score).toBe(0.85);
    });

    it('uses temperature from env when set', async () => {
      process.env.OPENAI_TEMPERATURE = '0.5';
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ pass: true, score: 0.8, reasoning: 'ok' }) } }],
        })),
      });

      const body = { rubric: 'Test', transcript: [], lastAssistant: 'Test' };
      await judgeConversation(body);

      expect(fetch).toHaveBeenCalled();
      const callArgs = fetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.temperature).toBe(0.5);
    });

    it('sets temperature to 1 when env is 0', async () => {
      process.env.OPENAI_TEMPERATURE = '0';
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ pass: true, score: 0.8, reasoning: 'ok' }) } }],
        })),
      });

      const body = { rubric: 'Test', transcript: [], lastAssistant: 'Test' };
      await judgeConversation(body);

      const callArgs = fetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.temperature).toBe(1);
    });

    it('defaults threshold when missing from response', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ pass: true, reasoning: 'Good' }) } }],
        })),
      });

      const body = { rubric: 'Test', threshold: 0.6, transcript: [], lastAssistant: 'Test' };
      const result = await judgeConversation(body);

      expect(result.threshold).toBe(0.6);
      expect(result.score).toBe(0.6); // Defaults to threshold when pass is true
    });

    it('defaults score to 0 when pass is false', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ pass: false, reasoning: 'Bad' }) } }],
        })),
      });

      const body = { rubric: 'Test', threshold: 0.6, transcript: [], lastAssistant: 'Test' };
      const result = await judgeConversation(body);

      expect(result.score).toBe(0);
    });
  });

  describe('judgeConversation with Bedrock', () => {
    const originalEnv = process.env;

    beforeEach(async () => {
      vi.resetModules();
      process.env = { ...originalEnv };
      process.env.JUDGE_PROVIDER = 'bedrock';
      delete process.env.OPENAI_API_KEY;
      vi.clearAllMocks();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('calls bedrock and returns parsed result', async () => {
      const { bedrockChatOnce } = await import('../lib/bedrockRuntime.js');
      (bedrockChatOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        JSON.stringify({ pass: true, score: 0.9, threshold: 0.75, reasoning: 'Bedrock judge passed' })
      );

      const body = {
        rubric: 'Test rubric',
        transcript: [],
        lastAssistant: 'Test response',
      };

      const result = await judgeConversation(body);

      expect(bedrockChatOnce).toHaveBeenCalled();
      expect(result.pass).toBe(true);
      expect(result.score).toBe(0.9);
      expect(result.reasoning).toBe('Bedrock judge passed');
    });

    it('handles bedrock response with markdown code blocks', async () => {
      const { bedrockChatOnce } = await import('../lib/bedrockRuntime.js');
      (bedrockChatOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        '```json\n{"pass": true, "score": 0.8, "reasoning": "Good"}\n```'
      );

      const body = { rubric: 'Test', transcript: [], lastAssistant: 'Test' };
      const result = await judgeConversation(body);

      expect(result.pass).toBe(true);
      expect(result.score).toBe(0.8);
    });

    it('returns error on bedrock failure', async () => {
      const { bedrockChatOnce } = await import('../lib/bedrockRuntime.js');
      (bedrockChatOnce as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Bedrock unavailable'));

      const body = { rubric: 'Test', transcript: [], lastAssistant: 'Test' };
      const result = await judgeConversation(body);

      expect(result.pass).toBe(false);
      expect(result.reasoning).toContain('judge_error');
      expect(result.reasoning).toContain('Bedrock unavailable');
    });

    it('uses custom model ID from env', async () => {
      process.env.BEDROCK_JUDGE_MODEL_ID = 'custom-model';
      const { bedrockChatOnce } = await import('../lib/bedrockRuntime.js');
      (bedrockChatOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        JSON.stringify({ pass: true, score: 0.7, reasoning: 'ok' })
      );

      const body = { rubric: 'Test', transcript: [], lastAssistant: 'Test' };
      await judgeConversation(body);

      expect(bedrockChatOnce).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'custom-model' })
      );
    });

    it('uses custom temperature from env', async () => {
      process.env.BEDROCK_JUDGE_TEMPERATURE = '0.5';
      const { bedrockChatOnce } = await import('../lib/bedrockRuntime.js');
      (bedrockChatOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        JSON.stringify({ pass: true, score: 0.7, reasoning: 'ok' })
      );

      const body = { rubric: 'Test', transcript: [], lastAssistant: 'Test' };
      await judgeConversation(body);

      expect(bedrockChatOnce).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 })
      );
    });
  });
});
