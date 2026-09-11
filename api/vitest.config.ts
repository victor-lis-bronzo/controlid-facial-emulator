import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    passWithNoTests: true,
    // Resilience / defense-in-depth: a legitimately heavy test must not be
    // able to starve the reporter RPC and trip the `onTaskUpdate` heartbeat.
    // The primary mitigation lives in the tests themselves (bounded work);
    // these generous timeouts add margin without globally slowing the suite.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
  },
});
