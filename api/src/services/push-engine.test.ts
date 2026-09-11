/**
 * Unit tests for {@link PushEngine}.
 *
 * Covers the no-target dispatch path (Req 5.5; design.md → "Error Handling"
 * table): with no Push_Target configured, `dispatch` records a `no_target`
 * outbound entry, performs NO HTTP POST, and returns a zero-attempt outcome.
 *
 * The HTTP client and retry sleep are injected so the test is hermetic (no real
 * network) and instant (no real retry delays).
 */
import { describe, it, expect, vi } from 'vitest';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { ConfigService } from './config-service.js';
import { InterceptionLogger } from './interception-logger.js';
import { PushEngine, type HttpPostFn, type SleepFn } from './push-engine.js';

/** A no-op sleep so retry backoff is instant in tests. */
const noopSleep: SleepFn = async () => {
  // intentionally immediate
};

interface Harness {
  db: DrizzleDb;
  config: ConfigService;
  logger: InterceptionLogger;
}

function freshHarness(): Harness {
  const db = createDb({ mode: 'ephemeral' });
  return {
    db,
    config: new ConfigService(db),
    logger: new InterceptionLogger(db),
  };
}

describe('PushEngine — no-target dispatch (Req 5.5)', () => {
  it('records no_target, performs no POST, and returns attempts:0 with failureCategory no_target', async () => {
    const { db, config, logger } = freshHarness();
    try {
      // No monitor target configured → resolvePushTarget() returns null.
      const httpPost = vi.fn<HttpPostFn>(async () => ({ statusCode: 200 }));

      const engine = new PushEngine({
        config,
        logger,
        httpPost,
        sleep: noopSleep,
      });

      const outcome = await engine.dispatch('dao', {
        object_changes: [],
        device_id: 478435,
      });

      // No HTTP attempt was made (Req 5.5).
      expect(httpPost).not.toHaveBeenCalled();

      // The returned outcome signals no_target with zero attempts.
      expect(outcome).toStrictEqual({
        success: false,
        target: null,
        attempts: 0,
        failureCategory: 'no_target',
      });

      // A single outbound record captures the no_target outcome.
      const rows = await logger.query();
      expect(rows).toHaveLength(1);
      const record = rows[0]!;
      expect(record.direction).toBe('outbound');
      expect(record.outcome).toBe('no_target');
      expect(record.failureCategory).toBe('no_target');
      expect(record.attempts).toBe(0);
      expect(record.method).toBe('POST');
    } finally {
      db.$client.close();
    }
  });

  it('resolvePushTarget returns null when no monitor target is configured', async () => {
    const { db, config, logger } = freshHarness();
    try {
      const engine = new PushEngine({ config, logger, sleep: noopSleep });
      const target = await engine.resolvePushTarget('dao');
      expect(target).toBeNull();
    } finally {
      db.$client.close();
    }
  });
});
