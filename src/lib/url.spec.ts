import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appendQuery } from './url.js';

describe('url utilities', () => {
  describe('appendQuery', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('appends query params to absolute URL', () => {
      const result = appendQuery('https://api.example.com/data', { foo: 'bar' });
      expect(result).toBe('https://api.example.com/data?foo=bar');
    });

    it('appends multiple query params', () => {
      const result = appendQuery('https://api.example.com/data', { foo: 'bar', count: 10 });
      expect(result).toContain('foo=bar');
      expect(result).toContain('count=10');
    });

    it('handles existing query params', () => {
      const result = appendQuery('https://api.example.com/data?existing=1', { foo: 'bar' });
      expect(result).toContain('existing=1');
      expect(result).toContain('foo=bar');
    });

    it('skips null and undefined values', () => {
      const result = appendQuery('https://api.example.com/data', { 
        foo: 'bar', 
        skip1: null, 
        skip2: undefined,
        keep: 'value',
      });
      expect(result).toContain('foo=bar');
      expect(result).toContain('keep=value');
      expect(result).not.toContain('skip1');
      expect(result).not.toContain('skip2');
    });

    it('converts non-string values to strings', () => {
      const result = appendQuery('https://api.example.com/data', { 
        num: 42, 
        bool: true,
      });
      expect(result).toContain('num=42');
      expect(result).toContain('bool=true');
    });

    it('handles empty input object', () => {
      const result = appendQuery('https://api.example.com/data', {});
      expect(result).toBe('https://api.example.com/data');
    });

    it('handles null/undefined input', () => {
      const result1 = appendQuery('https://api.example.com/data', null);
      const result2 = appendQuery('https://api.example.com/data', undefined);
      expect(result1).toBe('https://api.example.com/data');
      expect(result2).toBe('https://api.example.com/data');
    });

    it('uses default base URL for relative paths when API_BASE_URL not set', () => {
      delete process.env.API_BASE_URL;
      process.env.PORT = '3001';
      const result = appendQuery('/api/test', { id: '1' });
      expect(result).toContain('localhost:3001');
      expect(result).toContain('id=1');
    });

    it('uses API_BASE_URL for relative paths when set', () => {
      process.env.API_BASE_URL = 'https://custom-api.example.com';
      const result = appendQuery('/api/test', { id: '1' });
      expect(result).toContain('custom-api.example.com');
      expect(result).toContain('id=1');
    });

    it('encodes special characters in query params', () => {
      const result = appendQuery('https://api.example.com/data', { 
        query: 'hello world',
        special: 'a=b&c=d',
      });
      expect(result).toContain('query=hello+world');
    });
  });
});
