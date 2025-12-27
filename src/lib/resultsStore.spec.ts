import { describe, it, expect, vi, beforeEach, afterEach, MockInstance } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe('resultsStore', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('RESULTS_ENABLED', () => {
    it('is false by default', async () => {
      delete process.env.LAMDIS_RESULTS_ENABLED;
      const { RESULTS_ENABLED } = await import('./resultsStore.js');
      expect(RESULTS_ENABLED).toBe(false);
    });

    it('is true when env var is set to "true"', async () => {
      process.env.LAMDIS_RESULTS_ENABLED = 'true';
      const { RESULTS_ENABLED } = await import('./resultsStore.js');
      expect(RESULTS_ENABLED).toBe(true);
    });

    it('is false when env var is set to other values', async () => {
      process.env.LAMDIS_RESULTS_ENABLED = 'false';
      const { RESULTS_ENABLED } = await import('./resultsStore.js');
      expect(RESULTS_ENABLED).toBe(false);
    });
  });

  describe('writeRunResultToDisk', () => {
    it('does nothing when RESULTS_ENABLED is false', async () => {
      delete process.env.LAMDIS_RESULTS_ENABLED;
      const { writeRunResultToDisk } = await import('./resultsStore.js');
      
      await writeRunResultToDisk('test-run-123', { result: 'test' });
      
      expect(fs.mkdir).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('writes result to disk when enabled', async () => {
      process.env.LAMDIS_RESULTS_ENABLED = 'true';
      const { writeRunResultToDisk } = await import('./resultsStore.js');
      
      const payload = { result: 'test', count: 42 };
      await writeRunResultToDisk('test-run-456', payload);
      
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test-run-456.json'),
        JSON.stringify(payload, null, 2),
        'utf8'
      );
    });

    it('creates date-based directory', async () => {
      process.env.LAMDIS_RESULTS_ENABLED = 'true';
      const { writeRunResultToDisk } = await import('./resultsStore.js');
      
      await writeRunResultToDisk('run-id', {});
      
      // Directory should contain today's date in YYYY-MM-DD format
      const today = new Date().toISOString().slice(0, 10);
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(today),
        { recursive: true }
      );
    });

    it('uses custom results directory when set', async () => {
      process.env.LAMDIS_RESULTS_ENABLED = 'true';
      process.env.LAMDIS_RESULTS_DIR = '/custom/results/path';
      const { writeRunResultToDisk } = await import('./resultsStore.js');
      
      await writeRunResultToDisk('custom-run', { data: 'value' });
      
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('custom'),
        { recursive: true }
      );
    });
  });
});
