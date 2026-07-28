import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Serialize integration files: they drive the @actual-app/api module singleton and share
    // one ephemeral server, so they must not run concurrently.
    fileParallelism: false,
  },
});
