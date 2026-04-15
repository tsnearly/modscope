import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.git'],
    testTimeout: 30000, // 30 seconds for performance tests
    hookTimeout: 30000,
    teardownTimeout: 10000,
    reporter: ['verbose', 'json'],
    outputFile: {
      json: './test-results.json',
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
