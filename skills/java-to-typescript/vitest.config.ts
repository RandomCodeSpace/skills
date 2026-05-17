import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts', 'evals/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'evals/fixtures/**/sample/**'],
    environment: 'node',
    testTimeout: 10_000,
    cache: { dir: '.vitest-cache' },
  },
});
