import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    // Has to sit above the asyncUtilTimeout in test/setup.ts, or a test that
    // waits out a slow findBy dies on the test timeout instead.
    testTimeout: 20_000,
  },
});
