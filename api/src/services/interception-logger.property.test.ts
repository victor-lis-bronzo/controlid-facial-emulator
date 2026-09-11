/**
 * Property-based tests for {@link InterceptionLogger}.
 *
 * Each property from the design's "Correctness Properties" section is
 * implemented by exactly one fast-check property test (>= 100 runs), tagged with
 * its design property number:
 *
 *   - Property 4  (task 7.2): the interception log view is strictly newest-first.
 *   - Property 5  (task 7.3): the log retains exactly the 10,000 newest records.
 *   - Property 11 (task 7.4): inbound body truncation invariant at the 64 KB mark.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { InterceptionLogger, type InterceptionInput } from './interception-logger.js';

/** Open a fresh in-memory DB and logger for an isolated iteration. */
function freshLogger(): { db: DrizzleDb; logger: InterceptionLogger } {
  const db = createDb({ mode: 'ephemeral' });
  return { db, logger: new InterceptionLogger(db) };
}

/** A minimal, always-valid record descriptor for ordering/capacity tests. */
interface RecordDescriptor {
  direction: 'inbound' | 'outbound';
  method: string;
  path: string;
  body: string;
}

const recordDescriptorArb: fc.Arbitrary<RecordDescriptor> = fc.record({
  direction: fc.constantFrom<'inbound' | 'outbound'>('inbound', 'outbound'),
  method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE'),
  path: fc.string({ minLength: 1, maxLength: 40 }),
  body: fc.string({ maxLength: 128 }),
});

/** Record a descriptor via the direction-appropriate logger method. */
async function record(
  logger: InterceptionLogger,
  d: { direction: 'inbound' | 'outbound' } & Omit<InterceptionInput, 'truncated'>,
): Promise<void> {
  const input: InterceptionInput = {
    method: d.method,
    path: d.path,
    body: d.body,
    truncated: false,
    outcome: d.outcome,
    statusCode: d.statusCode,
    attempts: d.attempts,
    failureCategory: d.failureCategory,
    timestamp: d.timestamp,
  };
  if (d.direction === 'inbound') {
    await logger.recordInbound(input);
  } else {
    await logger.recordOutbound(input);
  }
}

describe('InterceptionLogger — property tests', () => {
  // Feature: controlid-facial-emulator, Property 4: Interception log is strictly newest-first
  it('returns recorded events ordered by strictly decreasing id (newest-first)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(recordDescriptorArb, { minLength: 1, maxLength: 60 }),
        async (descriptors) => {
          const { db, logger } = freshLogger();
          try {
            for (const d of descriptors) {
              await record(logger, d);
            }
            const rows = await logger.query();

            // One row per recorded event.
            expect(rows).toHaveLength(descriptors.length);

            // Ids are strictly decreasing (newest-first, Req 8.5).
            for (let i = 1; i < rows.length; i += 1) {
              expect(rows[i - 1]!.id).toBeGreaterThan(rows[i]!.id);
            }
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  // Feature: controlid-facial-emulator, Property 5: Interception log capacity cap
  it('retains exactly the 10000 newest records when more than 10000 are written', async () => {
    const capacity = 10_000;
    await fc.assert(
      fc.asyncProperty(
        // N in (10000, 10100] keeps each run fast while exceeding the cap.
        fc.integer({ min: capacity + 1, max: capacity + 100 }),
        async (n) => {
          const { db, logger } = freshLogger();
          try {
            // Batch inserts inside a single transaction for speed. A monotonic
            // marker (the sequence number) is embedded in the body so we can
            // verify which records were retained.
            db.$client.transaction(() => {
              for (let seq = 0; seq < n; seq += 1) {
                // Record synchronously via the promise (better-sqlite3 is sync).
                void logger.recordInbound({
                  method: 'POST',
                  path: '/x.fcgi',
                  body: `seq:${seq}`,
                  truncated: false,
                });
              }
            })();

            const rows = await logger.query();

            // Exactly `capacity` records retained (Req 8.7).
            expect(rows).toHaveLength(capacity);

            // The retained set is the last `capacity` written: markers must be
            // the sequence numbers [n - capacity, n).
            const markers = rows
              .map((r) => Number(r.body.slice('seq:'.length)))
              .sort((a, b) => a - b);
            expect(markers[0]).toBe(n - capacity);
            expect(markers[markers.length - 1]).toBe(n - 1);
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: 100 },
    );
    // Heavy property: ~100 runs x ~10.1k inserts each. Allow ample wall time so
    // the >= 100-iteration requirement is met without the default 5s cap.
  }, 180_000);

  // Feature: controlid-facial-emulator, Property 11: Inbound body truncation invariant
  it('truncates bodies over 64 KB to the first 64 KB and marks them truncated, else stores them in full', async () => {
    const limit = 65_536;
    await fc.assert(
      fc.asyncProperty(
        // Byte lengths straddling the 64 KB boundary.
        fc.integer({ min: 0, max: 130_000 }),
        async (byteLength) => {
          const { db, logger } = freshLogger();
          try {
            // ASCII body so byte length == character length exactly.
            const body = 'a'.repeat(byteLength);
            await logger.recordInbound({
              method: 'POST',
              path: '/y.fcgi',
              body,
              truncated: false,
            });

            const rows = await logger.query();
            expect(rows).toHaveLength(1);
            const stored = rows[0]!;
            const storedBytes = Buffer.byteLength(stored.body, 'utf8');

            if (byteLength > limit) {
              // Stored body is exactly the first 64 KB, marked truncated.
              expect(stored.truncated).toBe(true);
              expect(storedBytes).toBe(limit);
              expect(stored.body).toBe(body.slice(0, limit));
            } else {
              // Stored in full, not truncated.
              expect(stored.truncated).toBe(false);
              expect(stored.body).toBe(body);
              expect(storedBytes).toBe(byteLength);
            }
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});
