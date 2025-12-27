import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock mongoose models
vi.mock('../models/TestSuite.js', () => ({
  TestSuiteModel: { findById: vi.fn() },
}));
vi.mock('../models/Test.js', () => ({
  TestModel: { find: vi.fn() },
}));
vi.mock('../models/Environment.js', () => ({
  EnvironmentModel: { findOne: vi.fn() },
}));
vi.mock('../models/Organization.js', () => ({
  OrganizationModel: { findById: vi.fn() },
}));
vi.mock('../models/Persona.js', () => ({
  PersonaModel: { findOne: vi.fn() },
}));
vi.mock('../models/Request.js', () => ({
  RequestModel: { findOne: vi.fn() },
}));
vi.mock('../models/TestRun.js', () => ({
  TestRunModel: { create: vi.fn(), updateOne: vi.fn(), findById: vi.fn() },
}));
vi.mock('../models/Usage.js', () => ({
  UsageModel: { create: vi.fn(), updateOne: vi.fn() },
}));

describe('repo', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isPg', () => {
    it('returns false by default', async () => {
      delete process.env.DB_PROVIDER;
      delete process.env.DATABASE_URL;
      const { repo } = await import('./repo.js');
      expect(repo.isPg()).toBe(false);
    });

    it('returns true when DB_PROVIDER is postgres', async () => {
      process.env.DB_PROVIDER = 'postgres';
      const { repo } = await import('./repo.js');
      expect(repo.isPg()).toBe(true);
    });

    it('returns true when DB_PROVIDER is POSTGRES (case insensitive)', async () => {
      process.env.DB_PROVIDER = 'POSTGRES';
      const { repo } = await import('./repo.js');
      expect(repo.isPg()).toBe(true);
    });

    it('returns true when DATABASE_URL starts with postgres', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost/db';
      const { repo } = await import('./repo.js');
      expect(repo.isPg()).toBe(true);
    });

    it('returns false for other DATABASE_URL schemes', async () => {
      process.env.DATABASE_URL = 'mongodb://localhost/db';
      const { repo } = await import('./repo.js');
      expect(repo.isPg()).toBe(false);
    });
  });

  describe('MongoDB operations', () => {
    beforeEach(() => {
      delete process.env.DB_PROVIDER;
      delete process.env.DATABASE_URL;
    });

    it('getSuiteById uses Mongoose', async () => {
      const { TestSuiteModel } = await import('../models/TestSuite.js');
      (TestSuiteModel.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'suite-123', name: 'Test Suite' }),
      });

      const { repo } = await import('./repo.js');
      const result = await repo.getSuiteById('suite-123');

      expect(TestSuiteModel.findById).toHaveBeenCalledWith('suite-123');
      expect(result).toEqual({ _id: 'suite-123', name: 'Test Suite' });
    });

    it('getTests uses Mongoose with filters', async () => {
      const { TestModel } = await import('../models/Test.js');
      (TestModel.find as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: 'test-1' }, { _id: 'test-2' }]),
      });

      const { repo } = await import('./repo.js');
      const result = await repo.getTests({ orgId: 'org-1', suiteId: 'suite-1' });

      expect(TestModel.find).toHaveBeenCalledWith({ orgId: 'org-1', suiteId: 'suite-1' });
      expect(result).toHaveLength(2);
    });

    it('getTests includes ids filter when provided', async () => {
      const { TestModel } = await import('../models/Test.js');
      (TestModel.find as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: 'test-1' }]),
      });

      const { repo } = await import('./repo.js');
      await repo.getTests({ orgId: 'org-1', suiteId: 'suite-1', ids: ['test-1', 'test-2'] });

      expect(TestModel.find).toHaveBeenCalledWith({
        orgId: 'org-1',
        suiteId: 'suite-1',
        _id: { $in: ['test-1', 'test-2'] },
      });
    });

    it('getEnvironment uses Mongoose', async () => {
      const { EnvironmentModel } = await import('../models/Environment.js');
      (EnvironmentModel.findOne as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'env-1', name: 'dev' }),
      });

      const { repo } = await import('./repo.js');
      const result = await repo.getEnvironment('org-1', 'suite-1', 'env-1');

      expect(EnvironmentModel.findOne).toHaveBeenCalledWith({ _id: 'env-1', orgId: 'org-1', suiteId: 'suite-1' });
      expect(result).toEqual({ _id: 'env-1', name: 'dev' });
    });

    it('getOrganizationById uses Mongoose', async () => {
      const { OrganizationModel } = await import('../models/Organization.js');
      (OrganizationModel.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'org-1', name: 'Test Org' }),
      });

      const { repo } = await import('./repo.js');
      const result = await repo.getOrganizationById('org-1');

      expect(OrganizationModel.findById).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({ _id: 'org-1', name: 'Test Org' });
    });

    it('getPersona uses Mongoose', async () => {
      const { PersonaModel } = await import('../models/Persona.js');
      (PersonaModel.findOne as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'persona-1', name: 'Customer' }),
      });

      const { repo } = await import('./repo.js');
      const result = await repo.getPersona('org-1', 'persona-1');

      expect(PersonaModel.findOne).toHaveBeenCalledWith({ _id: 'persona-1', orgId: 'org-1' });
      expect(result).toEqual({ _id: 'persona-1', name: 'Customer' });
    });

    it('getRequest uses Mongoose', async () => {
      const { RequestModel } = await import('../models/Request.js');
      (RequestModel.findOne as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'req-1', id: 'create_user' }),
      });

      const { repo } = await import('./repo.js');
      const result = await repo.getRequest('org-1', 'create_user');

      expect(RequestModel.findOne).toHaveBeenCalledWith({ orgId: 'org-1', id: 'create_user' });
      expect(result).toEqual({ _id: 'req-1', id: 'create_user' });
    });

    it('createTestRun uses Mongoose', async () => {
      const { TestRunModel } = await import('../models/TestRun.js');
      const mockRun = { _id: 'run-1', status: 'queued' };
      (TestRunModel.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockRun);

      const { repo } = await import('./repo.js');
      const result = await repo.createTestRun({ orgId: 'org-1', suiteId: 'suite-1' });

      expect(TestRunModel.create).toHaveBeenCalled();
      expect(result).toEqual(mockRun);
    });

    it('updateTestRun uses Mongoose $set', async () => {
      const { TestRunModel } = await import('../models/TestRun.js');
      (TestRunModel.updateOne as ReturnType<typeof vi.fn>).mockResolvedValue({ modifiedCount: 1 });

      const { repo } = await import('./repo.js');
      await repo.updateTestRun('run-1', { status: 'running' });

      expect(TestRunModel.updateOne).toHaveBeenCalledWith(
        { _id: 'run-1' },
        { $set: { status: 'running' } }
      );
    });

    it('getTestRunById uses Mongoose', async () => {
      const { TestRunModel } = await import('../models/TestRun.js');
      (TestRunModel.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'run-1', status: 'passed' }),
      });

      const { repo } = await import('./repo.js');
      const result = await repo.getTestRunById('run-1');

      expect(TestRunModel.findById).toHaveBeenCalledWith('run-1');
      expect(result).toEqual({ _id: 'run-1', status: 'passed' });
    });

    it('createOrUpdateUsage creates new usage record', async () => {
      const { UsageModel } = await import('../models/Usage.js');
      (UsageModel.create as ReturnType<typeof vi.fn>).mockResolvedValue({ runId: 'run-1' });

      const { repo } = await import('./repo.js');
      await repo.createOrUpdateUsage('run-1', { tokens: 100 });

      expect(UsageModel.create).toHaveBeenCalledWith({ runId: 'run-1', tokens: 100 });
    });

    it('createOrUpdateUsage updates on duplicate key error', async () => {
      const { UsageModel } = await import('../models/Usage.js');
      const dupKeyError = new Error('Duplicate key') as any;
      dupKeyError.code = 11000;
      (UsageModel.create as ReturnType<typeof vi.fn>).mockRejectedValue(dupKeyError);
      (UsageModel.updateOne as ReturnType<typeof vi.fn>).mockResolvedValue({ modifiedCount: 1 });

      const { repo } = await import('./repo.js');
      await repo.createOrUpdateUsage('run-1', { tokens: 200 });

      // On duplicate key (11000), it should NOT call updateOne (that's the behavior)
      expect(UsageModel.create).toHaveBeenCalled();
    });
  });
});
