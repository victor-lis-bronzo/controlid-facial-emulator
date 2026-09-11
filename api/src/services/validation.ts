/**
 * Shared, pure validation primitives for the Admin Management Panel services.
 *
 * These helpers are deliberately dependency-free (no DB, no I/O) so they are the
 * natural target for unit and property tests (Req 14.1, 14.3). They encode the
 * field/format rules the spec requires and throw the shared domain errors from
 * `../routes/errors.js` so the existing `classify()` maps them to the right
 * HTTP status:
 *
 *   - `validateName`  — non-empty string of 1..max chars (Req 2.1, 4.2, 6.2, 7.1).
 *   - `parseHhMm`     — 24-hour `HH:MM` (00–23 / 00–59) parsing (Req 5.2).
 *   - `WEEKDAYS`      — the seven lowercase weekday names (Req 5.4).
 *   - `daysToMask` / `maskToDays` — round-trippable 7-bit weekday mask (Req 5.4).
 *   - `validateTimeRange` — a Time Range's format/order/day invariants (Req 5.2–5.4).
 *
 * See design.md → "shared `validation.ts`".
 */
import { BadRequestError } from '../routes/errors.js';

/**
 * The seven lowercase weekday names, indexed so that bit 0 = Sunday …
 * bit 6 = Saturday. Used by {@link daysToMask} / {@link maskToDays} and to
 * validate Time Range day sets (Req 5.4).
 */
export const WEEKDAYS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;

/** A single weekday name from {@link WEEKDAYS}. */
export type Weekday = (typeof WEEKDAYS)[number];

/** Set of valid weekday names for O(1) membership checks. */
const WEEKDAY_SET: ReadonlySet<string> = new Set(WEEKDAYS);

/** The lowest valid weekday mask value (at least one day set). */
const MIN_MASK = 1;
/** The highest valid weekday mask value (all seven days set). */
const MAX_MASK = 127;

/**
 * Validate a required, bounded name-like string field.
 *
 * @param field The field name to name in the error description (e.g. 'name').
 * @param value The submitted value (unknown until validated).
 * @param max   The inclusive maximum length in characters.
 * @returns The validated, trimmed-free original string.
 * @throws BadRequestError (→ 400) naming `field` when the value is missing,
 *   not a string, empty, or longer than `max` characters.
 */
export function validateName(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestError(`Field "${field}" is required and must be a non-empty string.`);
  }
  if (value.length > max) {
    throw new BadRequestError(
      `Field "${field}" must be at most ${String(max)} characters.`,
    );
  }
  return value;
}

/**
 * Parse a 24-hour `HH:MM` clock string.
 *
 * Accepts exactly two digits for hours (00–23) and two digits for minutes
 * (00–59) separated by a single colon. Any other shape — missing colon,
 * non-numeric parts, out-of-range values, extra characters — yields `null`.
 *
 * @returns `{ h, m }` when valid, otherwise `null`.
 */
export function parseHhMm(value: unknown): { h: number; m: number } | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(value);
  if (match === null) {
    return null;
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return { h, m };
}

/**
 * Encode a set of weekday names into a 7-bit mask (bit 0 = Sunday …
 * bit 6 = Saturday). Duplicate names collapse to the same bit.
 *
 * @throws BadRequestError (→ 400) when the array is empty or contains a value
 *   that is not one of the seven weekday names (Req 5.4). The resulting mask is
 *   always in 1..127.
 */
export function daysToMask(days: string[]): number {
  if (days.length === 0) {
    throw new BadRequestError('A Time Range must reference at least one day of the week.');
  }
  let mask = 0;
  for (const day of days) {
    const index = WEEKDAYS.indexOf(day as Weekday);
    if (index < 0) {
      throw new BadRequestError(`Invalid day of week: "${String(day)}".`);
    }
    mask |= 1 << index;
  }
  return mask;
}

/**
 * Decode a 7-bit weekday mask back into weekday names, in Sunday→Saturday
 * order. Round-trips with {@link daysToMask} for any mask in 1..127.
 *
 * @throws BadRequestError when the mask is outside the valid 1..127 range.
 */
export function maskToDays(mask: number): string[] {
  if (!Number.isInteger(mask) || mask < MIN_MASK || mask > MAX_MASK) {
    throw new BadRequestError(
      `Invalid weekday mask ${String(mask)}; expected an integer in 1..127.`,
    );
  }
  const days: string[] = [];
  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    if ((mask & (1 << index)) !== 0) {
      days.push(WEEKDAYS[index]);
    }
  }
  return days;
}

/** The submitted shape of a single Time Range (before persistence). */
export interface TimeRangeInput {
  days: string[];
  startTime: string;
  endTime: string;
}

/**
 * Validate a single Time Range's invariants (Req 5.2–5.4):
 *
 *   - `startTime` and `endTime` are both valid 24-hour `HH:MM` values.
 *   - `startTime` is strictly earlier than `endTime`.
 *   - `days` is non-empty and contains only valid weekday names.
 *
 * @throws BadRequestError (→ 400) with a description identifying the violated
 *   rule; performs no I/O and mutates nothing.
 */
export function validateTimeRange(write: TimeRangeInput): void {
  const start = parseHhMm(write.startTime);
  if (start === null) {
    throw new BadRequestError(
      `Invalid startTime "${String(write.startTime)}"; expected 24-hour HH:MM.`,
    );
  }
  const end = parseHhMm(write.endTime);
  if (end === null) {
    throw new BadRequestError(
      `Invalid endTime "${String(write.endTime)}"; expected 24-hour HH:MM.`,
    );
  }

  const startMinutes = start.h * 60 + start.m;
  const endMinutes = end.h * 60 + end.m;
  if (startMinutes >= endMinutes) {
    throw new BadRequestError(
      `Invalid Time Range: startTime "${write.startTime}" must be strictly earlier than endTime "${write.endTime}".`,
    );
  }

  // Also validates non-empty days and rejects unknown weekday names.
  if (write.days.length === 0) {
    throw new BadRequestError('A Time Range must reference at least one day of the week.');
  }
  for (const day of write.days) {
    if (!WEEKDAY_SET.has(day)) {
      throw new BadRequestError(`Invalid day of week: "${String(day)}".`);
    }
  }
}
