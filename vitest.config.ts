import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'test/**/*.spec.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/index.ts',
        'src/cli.ts',
        'src/models/**', // Mongoose schema definitions - no logic to test
        'src/lib/bedrockClient.ts', // Just client instantiation
        'src/lib/bedrockRuntime.ts', // Re-exports from bedrockChat
        'src/routes/**', // Route registration - better suited for integration tests
        'src/services/testExecution/**', // Complex orchestration - needs integration tests
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 10000,
  },
});
