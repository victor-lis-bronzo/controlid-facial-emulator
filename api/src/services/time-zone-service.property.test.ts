/**
 * Property-based test for the Time Range validity invariant (Correctness
 * Property 1; design.md → "Correctness Properties → Property 1").
 *
 * The Time Range validator (`validateTimeRange`) must ACCEPT a range (not throw)
 * IFF both `startTime` and `endTime` are valid 24-hour `HH:MM` values, the start
 * is strictly earlier than the end, and the day set is non-empty over the seven
 * valid weekdays. This is checked by comparing the validator's accept/reject
 * decision against an independent reference predicate across generated inputs
 * that mix valid `HH:MM` clock strings with arbitrary noise strings and day
 * sets drawn from the weekdays plus junk labels.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateTimeRange, WEEKDAYS } from './validation.js';

/** Reference predicate for a valid 24-hour HH:MM clock string. */
function isValidHhMm(value: string): boolean {
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Reference minute-of-day for a valid HH:MM string. */
function minutes(value: string): number {
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(value) as RegExpExecArray;
  return Number(match[1]) * 60 + Number(match[2]);
}

const WEEKDAY_SET = new Set<string>(WEEKDAYS);

/** A generator for valid HH:MM strings. */
const validHhMm = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** A time generator mixing valid HH:MM with arbitrary noise strings. */
const timeArb = fc.oneof(validHhMm, fc.string());

/** A day generator mixing the seven weekdays with arbitrary junk labels. */
const dayArb = fc.oneof(fc.constantFrom(...WEEKDAYS), fc.string());

// Feature: admin-management-panel, Property 1
describe('Property 1: Time Range validity', () => {
  it('accepts a Time Range iff both times are valid HH:MM, start < end, and days are non-empty valid weekdays', () => {
    fc.assert(
      fc.property(
        fc.record({
          startTime: timeArb,
          endTime: timeArb,
          days: fc.array(dayArb, { maxLength: 10 }),
        }),
        (range) => {
          const expectedAccept =
            isValidHhMm(range.startTime) &&
            isValidHhMm(range.endTime) &&
            minutes(range.startTime) < minutes(range.endTime) &&
            range.days.length > 0 &&
            range.days.every((d) => WEEKDAY_SET.has(d));

          let actualAccept = true;
          try {
            validateTimeRange(range);
          } catch {
            actualAccept = false;
          }

          expect(actualAccept).toBe(expectedAccept);
        },
      ),
      { numRuns: 200 },
    );
  });
});
