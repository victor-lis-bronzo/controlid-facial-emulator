/**
 * TimeZoneService — validation + referential integrity for Time Zone CRUD
 * (Req 5, 7.7).
 *
 * Owns the business rules; {@link TimeZoneRepository} performs typed DB access
 * and the weekday-name⇄bitmask encoding on write/read. Throws the shared domain
 * errors so the existing `classify()` maps them:
 *
 *   - Name 1–128 via `validateName` (Req 5.1) → `BadRequestError` (400).
 *   - Each Time Range validated (`HH:MM`, `start < end`, ≥ 1 valid weekday) via
 *     `validateTimeRange` (Req 5.2–5.4) → `BadRequestError` (400).
 *   - Unknown time-zone id on get/update/delete → `NotFoundError` (Req 5.6) → 404.
 *   - Deleting a Time Zone referenced by ≥ 1 Access Rule → `ConflictError` naming
 *     the referencing rules (Req 7.7) → 409, with no change persisted.
 *
 * See design.md → "Admin services → TimeZoneService".
 */
import { ConflictError, NotFoundError } from '../routes/errors.js';
import type {
  TimeRangeWrite,
  TimeZoneRepository,
  TimeZoneView,
} from '../repositories/time-zone-repository.js';
import { validateName, validateTimeRange } from './validation.js';

/** Maximum time-zone name length (Req 5.1). */
const MAX_NAME = 128;

export class TimeZoneService {
  public constructor(private readonly timeZones: TimeZoneRepository) {}

  /** List every Time Zone with its Time Ranges (Req 5.5). */
  async list(): Promise<TimeZoneView[]> {
    return this.timeZones.list();
  }

  /** Get a single Time Zone, or throw {@link NotFoundError} (Req 5.6). */
  async get(id: number): Promise<TimeZoneView> {
    const view = await this.timeZones.get(id);
    if (view === null) {
      throw new NotFoundError(`Time Zone ${String(id)} not found.`);
    }
    return view;
  }

  /** Create a Time Zone after validating its name and every Time Range (Req 5.1–5.4). */
  async create(name: unknown, ranges: TimeRangeWrite[]): Promise<TimeZoneView> {
    const validated = validateName('name', name, MAX_NAME);
    this.validateRanges(ranges);
    return this.timeZones.create(validated, ranges);
  }

  /**
   * Replace a Time Zone's name and Time Ranges (Req 5.7); 404 when absent, 400
   * on invalid name/range.
   */
  async update(id: number, name: unknown, ranges: TimeRangeWrite[]): Promise<TimeZoneView> {
    await this.get(id);
    const validated = validateName('name', name, MAX_NAME);
    this.validateRanges(ranges);
    return this.timeZones.update(id, validated, ranges);
  }

  /**
   * Delete a Time Zone (Req 5.8). Rejects with {@link ConflictError} (409) when
   * referenced by ≥ 1 Access Rule, naming those rules (Req 7.7).
   */
  async delete(id: number): Promise<void> {
    await this.get(id);
    const referencing = await this.timeZones.referencingAccessRules(id);
    if (referencing.length > 0) {
      throw new ConflictError(
        `Time Zone ${String(id)} is referenced by Access Rule(s): ${referencing.join(', ')}.`,
      );
    }
    await this.timeZones.delete(id);
  }

  /** Validate every submitted Time Range (Req 5.2–5.4); throws before any write. */
  private validateRanges(ranges: TimeRangeWrite[]): void {
    for (const range of ranges) {
      validateTimeRange(range);
    }
  }
}
