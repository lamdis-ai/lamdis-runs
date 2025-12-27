import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { decrypt } from './crypto.js';

describe('crypto utilities', () => {
  describe('decrypt', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns object unchanged if ENC_SECRET not set', () => {
      delete process.env.ENC_SECRET;
      const obj = { data: 'test' };
      expect(decrypt(obj)).toEqual(obj);
    });

    it('returns non-object values unchanged', () => {
      process.env.ENC_SECRET = 'test-secret';
      expect(decrypt(null)).toBeNull();
      expect(decrypt(undefined)).toBeUndefined();
      expect(decrypt('string')).toBe('string');
      expect(decrypt(42)).toBe(42);
    });

    it('returns object unchanged if missing iv, tag, or data', () => {
      process.env.ENC_SECRET = 'test-secret';
      expect(decrypt({ iv: 'test' })).toEqual({ iv: 'test' });
      expect(decrypt({ iv: 'test', tag: 'test' })).toEqual({ iv: 'test', tag: 'test' });
      expect(decrypt({ data: 'test' })).toEqual({ data: 'test' });
    });

    it('decrypts valid encrypted object', () => {
      const secret = 'my-secret-key-123';
      process.env.ENC_SECRET = secret;
      
      // Create an encrypted payload manually
      const originalData = { message: 'Hello, World!', count: 42 };
      const key = crypto.createHash('sha256').update(secret).digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(originalData), 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      
      const encryptedObj = {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
      };
      
      const result = decrypt(encryptedObj);
      expect(result).toEqual(originalData);
    });

    it('decrypts string data correctly', () => {
      const secret = 'another-secret';
      process.env.ENC_SECRET = secret;
      
      const originalData = 'simple string value';
      const key = crypto.createHash('sha256').update(secret).digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(originalData), 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      
      const encryptedObj = {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
      };
      
      const result = decrypt(encryptedObj);
      expect(result).toBe(originalData);
    });

    it('handles nested encrypted objects', () => {
      const secret = 'nested-secret';
      process.env.ENC_SECRET = secret;
      
      const originalData = { 
        nested: { deeply: { value: 'secret' } },
        array: [1, 2, 3],
      };
      const key = crypto.createHash('sha256').update(secret).digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(originalData), 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      
      const encryptedObj = {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
      };
      
      const result = decrypt(encryptedObj);
      expect(result).toEqual(originalData);
    });
  });
});
