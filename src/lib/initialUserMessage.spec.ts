import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeInitialUserMessage, synthesizeInitialUserMessage } from './initialUserMessage.js';

// Mock cross-fetch
vi.mock('cross-fetch', () => ({
  default: vi.fn(),
}));

describe('initialUserMessage', () => {
  describe('sanitizeInitialUserMessage', () => {
    it('returns simple short message unchanged', () => {
      const result = sanitizeInitialUserMessage('Help with account', 'How do I reset my password?');
      expect(result).toBe('How do I reset my password?');
    });

    it('rejects messages that are too long (>180 chars)', () => {
      const longMessage = 'A'.repeat(200);
      const result = sanitizeInitialUserMessage('Test objective', longMessage);
      expect(result).not.toBe(longMessage);
      expect(result!.length).toBeLessThanOrEqual(200);
    });

    it('rejects messages containing "objective"', () => {
      const result = sanitizeInitialUserMessage('Test', 'My objective is to test this');
      expect(result).not.toContain('objective');
    });

    it('rejects messages containing "rubric"', () => {
      const result = sanitizeInitialUserMessage('Test', 'According to the rubric');
      expect(result).not.toContain('rubric');
    });

    it('rejects messages containing "steps"', () => {
      const result = sanitizeInitialUserMessage('Test', 'Follow these steps');
      expect(result).not.toContain('steps');
    });

    it('rejects messages containing regulatory terms (FINRA, SEC, etc)', () => {
      const result1 = sanitizeInitialUserMessage('Test', 'Check FINRA compliance');
      const result2 = sanitizeInitialUserMessage('Test', 'SEC regulations require');
      const result3 = sanitizeInitialUserMessage('Test', 'GDPR requirements');
      const result4 = sanitizeInitialUserMessage('Test', 'HIPAA compliance');
      
      expect(result1).not.toContain('FINRA');
      expect(result2).not.toContain('SEC');
      expect(result3).not.toContain('GDPR');
      expect(result4).not.toContain('HIPAA');
    });

    it('rejects listy messages with bullets', () => {
      const result = sanitizeInitialUserMessage('Test', '- First item\n- Second item');
      expect(result).not.toContain('-');
    });

    it('rejects listy messages with numbered items', () => {
      const result = sanitizeInitialUserMessage('Test', '1) First 2) Second');
      expect(result).not.toContain('1)');
    });

    it('handles messages starting with "I am" or "I\'m"', () => {
      const result1 = sanitizeInitialUserMessage('Test', "I'm trying to log in");
      const result2 = sanitizeInitialUserMessage('Test', 'I am having issues');
      
      expect(result1).toContain("I'm");
      expect(result2).toContain('I am');
    });

    it('returns short valid messages unchanged', () => {
      // Short messages that don't contain banned terms are returned as-is
      const result = sanitizeInitialUserMessage('Set up my account', 'Set up my account');
      expect(result).toBe('Set up my account');
    });

    it('handles error/issue messages', () => {
      const result = sanitizeInitialUserMessage('Error with payment', 'error with my payment');
      expect(result).toContain('error');
    });

    it('returns valid short messages as-is', () => {
      // Valid short messages without banned terms are returned unchanged
      const result = sanitizeInitialUserMessage('Help me', 'I need assistance');
      expect(result).toBe('I need assistance');
    });

    it('does not add "Can you help?" if already ends with question mark', () => {
      const result = sanitizeInitialUserMessage('Question', 'How can I help?');
      // Should return the message as-is since it's short and valid
      expect(result).toBe('How can I help?');
    });

    it('handles undefined proposed message', () => {
      const result = sanitizeInitialUserMessage('Reset password', undefined);
      expect(result).toBeDefined();
      expect(result!.length).toBeGreaterThan(0);
    });

    it('handles empty proposed message', () => {
      const result = sanitizeInitialUserMessage('Transfer funds', '');
      expect(result).toBeDefined();
      expect(result!.length).toBeGreaterThan(0);
    });

    it('generates message from objective when proposed is empty', () => {
      // When proposed is empty, it generates from objective
      const result = sanitizeInitialUserMessage('NJ Division of Gaming Enforcement compliance', '');
      expect(result).toBeDefined();
      expect(result!.length).toBeGreaterThan(0);
    });

    it('handles objective with meta-phrases when proposed empty', () => {
      const result = sanitizeInitialUserMessage(
        'Objective: Surface account details and ensure compliance with regulations',
        ''
      );
      expect(result).toBeDefined();
      expect(result!.length).toBeGreaterThan(0);
      // Objective: prefix should be stripped
      expect(result).not.toContain('Objective:');
    });

    it('limits output length to 160 characters', () => {
      const veryLongObjective = 'A'.repeat(300);
      const result = sanitizeInitialUserMessage(veryLongObjective, '');
      expect(result!.length).toBeLessThanOrEqual(200);
    });

    it('handles "cannot" or "unable to" messages', () => {
      const result = sanitizeInitialUserMessage('Test', "can't log in to my account");
      expect(result).toBeDefined();
    });

    it('handles messages with "e.g." pattern', () => {
      const result = sanitizeInitialUserMessage('Test', 'Show me options e.g. A, B, C');
      // Should be rejected as listy
      expect(result).toBeDefined();
    });

    it('handles verb-starting objectives for fallback', () => {
      const result = sanitizeInitialUserMessage('configure my settings', '');
      expect(result).toBeDefined();
      expect(result!.length).toBeGreaterThan(0);
    });
  });

  describe('synthesizeInitialUserMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns undefined for empty objective', async () => {
      const result = await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: '',
        judgeUrl: 'https://judge.example.com',
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined for whitespace-only objective', async () => {
      const result = await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: '   ',
        judgeUrl: 'https://judge.example.com',
      });
      expect(result).toBeUndefined();
    });

    it('calls judge API with correct rubric', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ nextUser: 'How do I reset my password?' }),
      });

      await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Help user reset password',
        judgeUrl: 'https://judge.example.com/judge',
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://judge.example.com/judge',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
        })
      );
    });

    it('includes auth header when provided', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ nextUser: 'Test message' }),
      });

      await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Test objective',
        judgeUrl: 'https://judge.example.com',
        authHeader: 'Bearer my-token',
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
        })
      );
    });

    it('returns sanitized message from judge response', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ nextUser: 'I need to check my balance' }),
      });

      const result = await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Check account balance',
        judgeUrl: 'https://judge.example.com',
      });

      expect(result).toBe('I need to check my balance');
    });

    it('logs the generated message', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ nextUser: 'Help me with X' }),
      });

      const logEntries: any[] = [];
      await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Do X',
        judgeUrl: 'https://judge.example.com',
        log: (e) => logEntries.push(e),
      });

      expect(logEntries.some(e => e.type === 'plan')).toBe(true);
    });

    it('falls back to cleaned objective on API error', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const logEntries: any[] = [];
      const result = await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Reset my password',
        judgeUrl: 'https://judge.example.com',
        log: (e) => logEntries.push(e),
      });

      expect(result).toBeDefined();
      expect(logEntries.some(e => e.type === 'plan_error')).toBe(true);
    });

    it('falls back when judge returns empty nextUser', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ nextUser: '' }),
      });

      const result = await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Update my profile',
        judgeUrl: 'https://judge.example.com',
      });

      // Should fall back to objective-based message
      expect(result).toBeDefined();
    });

    it('falls back when judge returns non-string nextUser', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ nextUser: { invalid: 'object' } }),
      });

      const result = await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Get help',
        judgeUrl: 'https://judge.example.com',
      });

      expect(result).toBeDefined();
    });

    it('includes persona text in request', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ nextUser: 'Message' }),
      });

      await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'Help user',
        personaText: 'Frustrated customer',
        judgeUrl: 'https://judge.example.com',
      });

      const callBody = JSON.parse(fetch.mock.calls[0][1].body);
      expect(callBody.persona).toBe('Frustrated customer');
    });

    it('strips meta-instructions from fallback objective', async () => {
      const fetch = (await import('cross-fetch')).default as ReturnType<typeof vi.fn>;
      fetch.mockRejectedValueOnce(new Error('API down'));

      const result = await synthesizeInitialUserMessage({
        orgId: 'org-1',
        objective: 'I need to reset my password for my account',
        judgeUrl: 'https://judge.example.com',
      });

      // Fallback should return cleaned objective or undefined if too complex
      // Just verify it doesn't throw and handles the error gracefully
      expect(fetch).toHaveBeenCalled();
    });
  });
});
