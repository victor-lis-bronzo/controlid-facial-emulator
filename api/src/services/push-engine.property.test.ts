/**
 * Property-based tests for {@link PushEngine} (fast-check + vitest).
 *
 * Implements the design's Correctness Properties 2, 7, and 9, each as a single
 * fast-check property with >= 100 runs. Every iteration uses a fresh ephemeral
 * DB + ConfigService + InterceptionLogger and an INJECTED HTTP client + sleep so
 * the tests are hermetic (no real network) and instant (no real retry delays).
 *
 * See design.md → "Correctness Properties" (2, 7, 9) and
 * "Testing Strategy → Generators".
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { ConfigService } from './config-service.js';
import { InterceptionLogger } from './interception-logger.js';
import {
  PushEngine,
  PushTimeoutError,
  type HttpPostFn,
  type SleepFn,
} from './push-engine.js';

const RUNS = 100;

/** A no-op sleep so retry backoff is instant in tests. */
const noopSleep: SleepFn = async () => {
  // intentionally immediate
};

interface Harness {
  db: DrizzleDb;
  config: ConfigService;
  logger: InterceptionLogger;
}

/** A fresh, isolated config/logger/DB trio for one iteration. */
function freshHarness(): Harness {
  const db = createDb({ mode: 'ephemeral' });
  return { db, config: new ConfigService(db), logger: new InterceptionLogger(db) };
}

// --- Monitor-target generators (P2). ---
const arbHostname = fc.domain().filter((h) => h.length >= 1 && h.length <= 2048);
const arbPort = fc.integer({ min: 1, max: 65535 }).map((n) => String(n));
// A slug-like path with no leading slash and no trailing slash so composition is
// unambiguous (ConfigService strips leading/trailing slashes on resolve).
const arbPath = fc
  .webPath()
  .map((p) => p.replace(/^\/+/, '').replace(/\/+$/, ''))
  .filter((p) => p.length >= 1 && p.length <= 512);
const arbEndpoint = fc.constantFrom('dao', 'device_is_alive', 'access_photo', 'operation_mode', 'door');

describe('PushEngine — property tests', () => {
  // Feature: controlid-facial-emulator, Property 2: Push re-targeting composes the exact destination URL
  it('dispatches to exactly http://<hostname>:<port>/<path>/<endpoint>', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbHostname,
        arbPort,
        arbPath,
        arbEndpoint,
        async (hostname, port, path, endpoint) => {
          const { db, config, logger } = freshHarness();
          try {
            await config.set({ monitor: { hostname, port, path } });

            const capturedUrls: string[] = [];
            const httpPost: HttpPostFn = async (url) => {
              capturedUrls.push(url);
              return { statusCode: 200 };
            };

            const engine = new PushEngine({
              config,
              logger,
              httpPost,
              sleep: noopSleep,
            });

            const outcome = await engine.dispatch(endpoint, { hello: 'world' });

            const expectedUrl = `http://${hostname}:${port}/${path}/${endpoint}`;
            expect(capturedUrls).toEqual([expectedUrl]);
            expect(outcome.target).toBe(expectedUrl);
            expect(outcome.success).toBe(true);
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: controlid-facial-emulator, Property 7: Push retry is bounded to four attempts
  it('records exactly 4 attempts and a failure for a perpetually-failing target', async () => {
    // A failing client either always times out or always is unreachable.
    const arbFailureMode = fc.constantFrom<'timeout' | 'unreachable'>(
      'timeout',
      'unreachable',
    );

    await fc.assert(
      fc.asyncProperty(
        arbHostname,
        arbPort,
        arbPath,
        arbFailureMode,
        async (hostname, port, path, failureMode) => {
          const { db, config, logger } = freshHarness();
          try {
            await config.set({ monitor: { hostname, port, path } });

            let calls = 0;
            const httpPost: HttpPostFn = async () => {
              calls += 1;
              if (failureMode === 'timeout') {
                // Signal a timeout exactly as the default undici client does.
                throw new PushTimeoutError();
              }
              throw new Error('ECONNREFUSED');
            };

            const engine = new PushEngine({
              config,
              logger,
              httpPost,
              sleep: noopSleep,
            });

            const outcome = await engine.dispatch('dao', { any: 'payload' });

            // Exactly 1 + 3 = 4 attempts (Req 5.7).
            expect(calls).toBe(4);
            expect(outcome.attempts).toBe(4);
            expect(outcome.success).toBe(false);
            expect(outcome.target).toBe(`http://${hostname}:${port}/${path}/dao`);
            expect(outcome.failureCategory).not.toBe('no_target');

            // The interception record captures the target and the attempt count.
            const rows = await logger.query();
            expect(rows).toHaveLength(1);
            const record = rows[0]!;
            expect(record.direction).toBe('outbound');
            expect(record.outcome).toBe('failure');
            expect(record.attempts).toBe(4);
            expect(record.path).toBe(`http://${hostname}:${port}/${path}/dao`);
            expect(record.failureCategory).toBeDefined();

            if (failureMode === 'timeout') {
              expect(outcome.timedOut).toBe(true);
              expect(outcome.failureCategory).toBe('timeout');
            } else {
              expect(outcome.failureCategory).toBe('unreachable');
            }
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: controlid-facial-emulator, Property 9: HTTP 2xx classification of dispatch outcomes
  it('treats a dispatch as successful if and only if the status code is in 200-299', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 599 }),
        async (statusCode) => {
          const { db, config, logger } = freshHarness();
          try {
            await config.set({
              monitor: { hostname: 'client.example.com', port: '8000', path: 'api/notifications' },
            });

            let calls = 0;
            const httpPost: HttpPostFn = async () => {
              calls += 1;
              return { statusCode };
            };

            const engine = new PushEngine({
              config,
              logger,
              httpPost,
              sleep: noopSleep,
            });

            const outcome = await engine.dispatch('dao', { any: 'payload' });

            const is2xx = statusCode >= 200 && statusCode <= 299;
            // Success iff the returned code is 2xx (Req 5.2).
            expect(outcome.success).toBe(is2xx);
            expect(outcome.statusCode).toBe(statusCode);

            if (is2xx) {
              // A 2xx response succeeds on the first attempt (no retries).
              expect(outcome.attempts).toBe(1);
              expect(calls).toBe(1);
              expect(outcome.failureCategory).toBeUndefined();
            } else {
              // Non-2xx retries then fails after 4 attempts, classified http_error.
              expect(outcome.attempts).toBe(4);
              expect(calls).toBe(4);
              expect(outcome.failureCategory).toBe('http_error');
            }
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
