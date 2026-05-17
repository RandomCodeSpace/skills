import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts', 'evals/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    cache: { dir: '.vitest-cache' },
  },
});
