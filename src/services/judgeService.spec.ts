import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { judgeBodySchema, judgeConversation } from './judgeService.js';

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
  });
});
