/**
 * Unit tests for the shared validation primitives (task 2.3, Req 14.1) and the
 * new `NotFoundError` / `ConflictError` classification (task 2.1).
 *
 * Covers:
 *   - `validateName` length bounds (1/64, 1/128, empty, over-length).
 *   - `parseHhMm` edges ('00:00', '23:59', '24:00', '12:60', non-numeric,
 *     missing colon).
 *   - `daysToMask` / `maskToDays` round-trip over random weekday subsets.
 *   - `validateTimeRange` accept/reject cases.
 *   - `NotFoundError` / `ConflictError` produce 404 / 409 via `classify()`.
 *
 * See design.md → "Testing Strategy → Unit".
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Fastify from 'fastify';
import {
  WEEKDAYS,
  validateName,
  parseHhMm,
  daysToMask,
  maskToDays,
  validateTimeRange,
} from './validation.js';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  installErrorHandlers,
} from '../routes/errors.js';

const RUNS = 100;

describe('validateName (Req 2.1, 4.2, 6.2, 7.1)', () => {
  it('accepts a single-character name and returns it unchanged', () => {
    expect(validateName('name', 'x', 128)).toBe('x');
  });

  it('accepts a name at the exact 64-character bound', () => {
    const value = 'a'.repeat(64);
    expect(validateName('registration', value, 64)).toBe(value);
  });

  it('accepts a name at the exact 128-character bound', () => {
    const value = 'b'.repeat(128);
    expect(validateName('name', value, 128)).toBe(value);
  });

  it('rejects an empty string with a BadRequestError naming the field', () => {
    expect(() => validateName('registration', '', 64)).toThrow(BadRequestError);
    expect(() => validateName('registration', '', 64)).toThrow(/registration/);
  });

  it('rejects a missing (non-string) value', () => {
    expect(() => validateName('name', undefined, 128)).toThrow(BadRequestError);
    expect(() => validateName('name', 42, 128)).toThrow(BadRequestError);
    expect(() => validateName('name', null, 128)).toThrow(BadRequestError);
  });

  it('rejects a value one character over the 64 bound', () => {
    expect(() => validateName('registration', 'a'.repeat(65), 64)).toThrow(
      BadRequestError,
    );
  });

  it('rejects a value one character over the 128 bound', () => {
    expect(() => validateName('name', 'b'.repeat(129), 128)).toThrow(BadRequestError);
  });
});

describe('parseHhMm (Req 5.2)', () => {
  it("parses the lower bound '00:00'", () => {
    expect(parseHhMm('00:00')).toEqual({ h: 0, m: 0 });
  });

  it("parses the upper bound '23:59'", () => {
    expect(parseHhMm('23:59')).toEqual({ h: 23, m: 59 });
  });

  it("rejects an out-of-range hour '24:00'", () => {
    expect(parseHhMm('24:00')).toBeNull();
  });

  it("rejects an out-of-range minute '12:60'", () => {
    expect(parseHhMm('12:60')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parseHhMm('ab:cd')).toBeNull();
    expect(parseHhMm('1a:00')).toBeNull();
  });

  it('rejects a missing colon and malformed shapes', () => {
    expect(parseHhMm('1200')).toBeNull();
    expect(parseHhMm('12:0')).toBeNull();
    expect(parseHhMm('2:00')).toBeNull();
    expect(parseHhMm('12:00:00')).toBeNull();
    expect(parseHhMm('')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(parseHhMm(1200)).toBeNull();
    expect(parseHhMm(undefined)).toBeNull();
    expect(parseHhMm(null)).toBeNull();
  });
});

describe('daysToMask / maskToDays round-trip (Req 5.4)', () => {
  it('round-trips over random non-empty weekday subsets', () => {
    fc.assert(
      fc.property(
        // A non-empty subset of the seven weekday names (unique, any order).
        fc
          .subarray([...WEEKDAYS], { minLength: 1 })
          .map((sub) => [...new Set(sub)]),
        (days) => {
          const mask = daysToMask(days);
          expect(mask).toBeGreaterThanOrEqual(1);
          expect(mask).toBeLessThanOrEqual(127);
          const decoded = maskToDays(mask);
          // Order-insensitive equality of the day sets.
          expect(new Set(decoded)).toEqual(new Set(days));
          // Re-encoding the decoded set yields the identical mask.
          expect(daysToMask(decoded)).toBe(mask);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('maps single days to their expected bit positions', () => {
    expect(daysToMask(['sun'])).toBe(1);
    expect(daysToMask(['sat'])).toBe(64);
    expect(daysToMask([...WEEKDAYS])).toBe(127);
  });

  it('rejects an empty day set', () => {
    expect(() => daysToMask([])).toThrow(BadRequestError);
  });

  it('rejects an unknown weekday name', () => {
    expect(() => daysToMask(['funday'])).toThrow(BadRequestError);
  });

  it('rejects out-of-range masks in maskToDays', () => {
    expect(() => maskToDays(0)).toThrow(BadRequestError);
    expect(() => maskToDays(128)).toThrow(BadRequestError);
    expect(() => maskToDays(-1)).toThrow(BadRequestError);
  });
});

describe('validateTimeRange (Req 5.2, 5.3, 5.4)', () => {
  it('accepts a valid range with a valid, non-empty day set', () => {
    expect(() =>
      validateTimeRange({ days: ['mon', 'tue'], startTime: '08:00', endTime: '17:30' }),
    ).not.toThrow();
  });

  it('rejects a malformed startTime', () => {
    expect(() =>
      validateTimeRange({ days: ['mon'], startTime: '8:00', endTime: '17:00' }),
    ).toThrow(BadRequestError);
  });

  it('rejects a malformed endTime', () => {
    expect(() =>
      validateTimeRange({ days: ['mon'], startTime: '08:00', endTime: '25:00' }),
    ).toThrow(BadRequestError);
  });

  it('rejects a range where start is not strictly earlier than end (equal)', () => {
    expect(() =>
      validateTimeRange({ days: ['mon'], startTime: '09:00', endTime: '09:00' }),
    ).toThrow(BadRequestError);
  });

  it('rejects a range where start is after end', () => {
    expect(() =>
      validateTimeRange({ days: ['mon'], startTime: '18:00', endTime: '09:00' }),
    ).toThrow(BadRequestError);
  });

  it('rejects an empty day set', () => {
    expect(() =>
      validateTimeRange({ days: [], startTime: '08:00', endTime: '17:00' }),
    ).toThrow(BadRequestError);
  });

  it('rejects an unknown weekday value', () => {
    expect(() =>
      validateTimeRange({ days: ['mon', 'noday'], startTime: '08:00', endTime: '17:00' }),
    ).toThrow(BadRequestError);
  });
});

describe('domain error classification (task 2.1)', () => {
  it('NotFoundError carries statusCode 404 and a description', () => {
    const err = new NotFoundError('User 99 not found');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('NotFoundError');
    expect(err.description).toBe('User 99 not found');
    expect(err instanceof Error).toBe(true);
  });

  it('ConflictError carries statusCode 409 and a description', () => {
    const err = new ConflictError('Group referenced by Access Rule 3');
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe('ConflictError');
    expect(err.description).toBe('Group referenced by Access Rule 3');
    expect(err instanceof Error).toBe(true);
  });

  it('NotFoundError renders as 404 with an error-description via classify()', async () => {
    const app = Fastify();
    installErrorHandlers(app);
    app.get('/missing', () => {
      throw new NotFoundError('User 99 not found');
    });
    const response = await app.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({ 'error-description': 'User 99 not found' });
    await app.close();
  });

  it('ConflictError renders as 409 with an error-description via classify()', async () => {
    const app = Fastify();
    installErrorHandlers(app);
    app.get('/conflict', () => {
      throw new ConflictError('Group referenced by Access Rule 3');
    });
    const response = await app.inject({ method: 'GET', url: '/conflict' });
    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({
      'error-description': 'Group referenced by Access Rule 3',
    });
    await app.close();
  });
});
