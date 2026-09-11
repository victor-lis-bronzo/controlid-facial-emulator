/**
 * Property-based tests for {@link ConfigService} (fast-check + vitest).
 *
 * Implements the design's Correctness Properties 1, 6, and 8, each as a single
 * fast-check property with >= 100 runs and a fresh ephemeral DB + ConfigService
 * per iteration so no state leaks between runs.
 *
 * See design.md → "Correctness Properties" and "Testing Strategy → Generators".
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createDb } from '../db/connection.js';
import { ConfigService, ValidationError } from './config-service.js';
import { DEFAULT_MONITOR_CONFIG } from '../shared/index.js';

const RUNS = 100;

/** A fresh, isolated ConfigService over an in-memory DB for one iteration. */
function freshService(): ConfigService {
  const db = createDb({ mode: 'ephemeral' });
  return new ConfigService(db);
}

// --- Generators over recognized monitor keys with valid value domains. ---

const arbHostname = fc
  .domain()
  .filter((h) => h.length >= 1 && h.length <= 2048);
const arbPort = fc.integer({ min: 1, max: 65535 }).map((n) => String(n));
const arbPath = fc
  .webPath()
  .map((p) => p.replace(/^\/+/, ''))
  .filter((p) => p.length <= 2048);
const arbRequestTimeout = fc.integer({ min: 0, max: 600000 }).map(String);
const arbAliveInterval = fc.integer({ min: 1, max: 3_600_000 });
const arbEnablePhotoUpload = fc.constantFrom<0 | 1>(0, 1);

/** A partial, valid monitor patch drawn over an arbitrary subset of keys. */
const arbValidMonitorPatch = fc.record(
  {
    hostname: arbHostname,
    port: arbPort,
    path: arbPath,
    request_timeout: arbRequestTimeout,
    alive_interval: arbAliveInterval,
    enable_photo_upload: arbEnablePhotoUpload,
  },
  { requiredKeys: [] },
);

describe('ConfigService property tests', () => {
  // Feature: controlid-facial-emulator, Property 1: Configuration round-trip — for any valid config write, a subsequent read returns exactly the written values (merged over defaults for unwritten keys).
  it('Property 1: configuration round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidMonitorPatch, async (patch) => {
        const svc = freshService();
        await svc.set({ monitor: patch });
        const read = await svc.get('monitor');

        const expected: Record<string, unknown> = {
          ...DEFAULT_MONITOR_CONFIG,
          ...patch,
        };
        expect(read).toStrictEqual(expected);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: controlid-facial-emulator, Property 6: Idempotent (last-write-wins) config replace — for any recognized key and any two valid values written in sequence, a read returns only the second value.
  it('Property 6: last-write-wins config replace', async () => {
    const arbKeyedPair = fc.oneof(
      fc
        .tuple(arbHostname, arbHostname)
        .map(([a, b]) => ({ key: 'hostname' as const, first: a, second: b })),
      fc
        .tuple(arbPort, arbPort)
        .map(([a, b]) => ({ key: 'port' as const, first: a, second: b })),
      fc
        .tuple(arbPath, arbPath)
        .map(([a, b]) => ({ key: 'path' as const, first: a, second: b })),
      fc
        .tuple(arbRequestTimeout, arbRequestTimeout)
        .map(([a, b]) => ({
          key: 'request_timeout' as const,
          first: a,
          second: b,
        })),
      fc
        .tuple(arbAliveInterval, arbAliveInterval)
        .map(([a, b]) => ({
          key: 'alive_interval' as const,
          first: a,
          second: b,
        })),
      fc
        .tuple(arbEnablePhotoUpload, arbEnablePhotoUpload)
        .map(([a, b]) => ({
          key: 'enable_photo_upload' as const,
          first: a,
          second: b,
        })),
    );

    await fc.assert(
      fc.asyncProperty(arbKeyedPair, async ({ key, first, second }) => {
        const svc = freshService();
        await svc.set({ monitor: { [key]: first } });
        await svc.set({ monitor: { [key]: second } });
        const read = await svc.get('monitor', [key]);
        expect(read).toStrictEqual({ [key]: second });
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: controlid-facial-emulator, Property 8: Config validation is all-or-nothing — for any patch containing at least one invalid key or value, set rejects (throws), the store is unchanged (a get after equals the get before), and the error identifies a rejected key.
  it('Property 8: config validation is all-or-nothing', async () => {
    // An "invalid entry": either an unrecognized key, or a recognized key with
    // an out-of-domain value.
    const arbInvalidEntry = fc.oneof(
      // Unrecognized key on the monitor module.
      fc
        .string({ minLength: 1, maxLength: 12 })
        .filter(
          (k) =>
            ![
              'hostname',
              'port',
              'path',
              'request_timeout',
              'alive_interval',
              'enable_photo_upload',
            ].includes(k),
        )
        .map((k) => ({ patch: { [k]: 'x' }, badKey: k })),
      // port out of numeric range / non-numeric.
      fc
        .oneof(
          fc.integer({ min: 65536, max: 200000 }).map(String),
          fc.constantFrom('0', 'abc', '-5', '12.5'),
        )
        .map((v) => ({ patch: { port: v }, badKey: 'port' })),
      // alive_interval not a positive integer.
      fc
        .oneof(
          fc.integer({ min: -1000, max: 0 }),
          fc.constantFrom<unknown>('30000', 1.5, true, null),
        )
        .map((v) => ({ patch: { alive_interval: v }, badKey: 'alive_interval' })),
      // enable_photo_upload not in {0,1}.
      fc
        .constantFrom<unknown>(2, -1, '1', true, null)
        .map((v) => ({ patch: { enable_photo_upload: v }, badKey: 'enable_photo_upload' })),
      // hostname of the wrong type.
      fc
        .constantFrom<unknown>(123, true, null, {})
        .map((v) => ({ patch: { hostname: v }, badKey: 'hostname' })),
    );

    await fc.assert(
      fc.asyncProperty(
        arbValidMonitorPatch,
        arbInvalidEntry,
        async (validPart, invalid) => {
          const svc = freshService();

          // Seed a known baseline so "unchanged" is observable and non-trivial.
          await svc.set({
            monitor: { hostname: 'seed.example.com', port: '8000' },
          });
          const before = await svc.get('monitor');

          // A patch mixing valid entries with one invalid entry.
          const patch = {
            monitor: { ...validPart, ...invalid.patch },
          } as Record<string, Record<string, unknown>>;

          let thrown: unknown;
          try {
            await svc.set(patch);
            expect.fail('expected set to throw a ValidationError');
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(ValidationError);
          const verr = thrown as ValidationError;
          // The error identifies a rejected key.
          expect(verr.key ?? verr.message).toContain(invalid.badKey);

          // The store is unchanged.
          const after = await svc.get('monitor');
          expect(after).toStrictEqual(before);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
