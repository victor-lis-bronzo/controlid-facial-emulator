/**
 * Property-based test for {@link ObjectStore.load} filtered access-log queries.
 *
 * Implements exactly one correctness property from the design's "Correctness
 * Properties" section (Property 10), with ≥ 100 iterations, using fast-check.
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { createDb } from '../db/connection.js';
import { ObjectStore } from './object-store.js';

/**
 * The wire columns of `access_logs` that we generate/filter on. `id` is
 * excluded from generation because it is assigned by the store on insert.
 */
const FILTERABLE_FIELDS = [
  'time',
  'event',
  'device_id',
  'identifier_id',
  'user_id',
  'portal_id',
  'identification_rule_id',
  'card_value',
  'log_type_id',
] as const;

type FilterableField = (typeof FILTERABLE_FIELDS)[number];

/** Small value alphabet so generated records frequently share field values. */
const smallValue = fc.constantFrom('0', '1', '6', '7', 'a', 'b', 'x');

/** Generator for a single access_logs record (wire shape, all strings). */
const recordArb: fc.Arbitrary<Record<FilterableField, string>> = fc.record({
  time: smallValue,
  event: smallValue,
  device_id: smallValue,
  identifier_id: smallValue,
  user_id: smallValue,
  portal_id: smallValue,
  identification_rule_id: smallValue,
  card_value: smallValue,
  log_type_id: smallValue,
});

// Feature: controlid-facial-emulator, Property 10: for any set of access_logs records and any subset of valid filter parameters drawn from an existing record's own field values, load('access_logs', filters) returns exactly the records for which every supplied filter matches — none missing, none extra.
describe('ObjectStore.load — Property 10: filtered queries return the exact matching subset', () => {
  it('returns precisely the records matching every supplied filter (AND semantics)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // At least one record so we can draw a filter subset from a real row.
        fc.array(recordArb, { minLength: 1, maxLength: 12 }),
        // Which fields to use as the filter subset (possibly empty → match all).
        fc.subarray([...FILTERABLE_FIELDS]),
        // Index into the records to draw the filter values from.
        fc.nat(),
        async (records, filterFields, pivotSeed) => {
          const db = createDb({ mode: 'ephemeral' });
          try {
            const store = new ObjectStore(db);
            await store.create('access_logs', records);

            // Draw the filter values from an existing record's own values so
            // the filter is guaranteed valid and matches at least that record.
            const pivot = records[pivotSeed % records.length];
            const filters: Record<string, string> = {};
            for (const field of filterFields) {
              filters[field] = pivot[field];
            }

            // Expected matches computed independently in-test.
            const expected = records.filter((rec) =>
              filterFields.every((field) => rec[field] === pivot[field]),
            );

            const loaded = await store.load('access_logs', filters);

            // Compare as multisets of the filterable field values (ids differ
            // because they are store-assigned; the record contents must match).
            const key = (r: Record<string, unknown>): string =>
              FILTERABLE_FIELDS.map((f) => String(r[f])).join('\u0001');

            const expectedCounts = new Map<string, number>();
            for (const r of expected) {
              const k = key(r);
              expectedCounts.set(k, (expectedCounts.get(k) ?? 0) + 1);
            }
            const loadedCounts = new Map<string, number>();
            for (const r of loaded) {
              const k = key(r);
              loadedCounts.set(k, (loadedCounts.get(k) ?? 0) + 1);
            }

            // None missing, none extra: the multisets must be identical.
            if (loaded.length !== expected.length) {
              return false;
            }
            for (const [k, count] of expectedCounts) {
              if (loadedCounts.get(k) !== count) {
                return false;
              }
            }
            for (const [k, count] of loadedCounts) {
              if (expectedCounts.get(k) !== count) {
                return false;
              }
            }
            return true;
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
