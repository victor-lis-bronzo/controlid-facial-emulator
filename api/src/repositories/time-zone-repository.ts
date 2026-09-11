/**
 * TimeZoneRepository — typed reads/writes for Time Zones and their owned Time
 * Ranges (Req 5.1, 5.5, 5.7, 5.8) plus the referential-integrity lookup used by
 * the service layer to produce the `409` when a referenced Time Zone is deleted
 * (Req 7.7).
 *
 * Time Range weekday sets are persisted as a 7-bit `days` mask via
 * {@link daysToMask} and decoded back to weekday-name arrays on read via
 * {@link maskToDays} (design decision: compact, index-friendly mask). Name and
 * per-range format validation live in {@link TimeZoneService}; this repository
 * performs only typed DB access over {@link DrizzleDb}. Ranges are written
 * transactionally with their zone so a failure persists nothing.
 *
 * See design.md → "TimeZoneRepository".
 */
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { accessRuleTimeZones, timeRanges, timeZones } from '../db/schema.js';
import { daysToMask, maskToDays } from '../services/validation.js';

/** Read projection of a single Time Range (Req 5.5). */
export interface TimeRangeView {
  id: number;
  /** Weekday names decoded from the 7-bit mask (e.g. ['mon','tue']). */
  days: string[];
  /** 'HH:MM' 24-hour start. */
  startTime: string;
  /** 'HH:MM' 24-hour end. */
  endTime: string;
}

/** Read projection of a Time Zone with its Time Ranges (Req 5.5). */
export interface TimeZoneView {
  id: number;
  name: string;
  timeRanges: TimeRangeView[];
}

/** The submitted shape of a single Time Range (before persistence). */
export interface TimeRangeWrite {
  days: string[];
  startTime: string;
  endTime: string;
}

export class TimeZoneRepository {
  public constructor(private readonly db: DrizzleDb) {}

  /** Return every Time Zone with its Time Ranges (Req 5.5). */
  async list(): Promise<TimeZoneView[]> {
    const zones = this.db.select().from(timeZones).all();
    const ranges = this.db.select().from(timeRanges).all();
    const byZone = new Map<number, TimeRangeView[]>();
    for (const r of ranges) {
      const list = byZone.get(r.timeZoneId) ?? [];
      list.push(this.toRangeView(r));
      byZone.set(r.timeZoneId, list);
    }
    return zones.map((z) => ({
      id: z.id,
      name: z.name,
      timeRanges: byZone.get(z.id) ?? [],
    }));
  }

  /** Return a single Time Zone with its Time Ranges, or `null` (Req 5.6). */
  async get(id: number): Promise<TimeZoneView | null> {
    const zone = this.db.select().from(timeZones).where(eq(timeZones.id, id)).get();
    if (!zone) {
      return null;
    }
    return { id: zone.id, name: zone.name, timeRanges: this.rangesOf(id) };
  }

  /**
   * Create a Time Zone and persist its Time Ranges (Req 5.1). The zone row and
   * its `time_ranges` rows are written in a single transaction.
   */
  async create(name: string, ranges: TimeRangeWrite[]): Promise<TimeZoneView> {
    const id = this.db.transaction((tx) => {
      const inserted = tx.insert(timeZones).values({ name }).run();
      const zoneId = Number(inserted.lastInsertRowid);
      for (const range of ranges) {
        tx.insert(timeRanges)
          .values({
            timeZoneId: zoneId,
            days: daysToMask(range.days),
            startTime: range.startTime,
            endTime: range.endTime,
          })
          .run();
      }
      return zoneId;
    });
    return { id, name, timeRanges: this.rangesOf(id) };
  }

  /**
   * Replace a Time Zone's name and Time Ranges with the submitted values
   * (Req 5.7), transactionally.
   */
  async update(id: number, name: string, ranges: TimeRangeWrite[]): Promise<TimeZoneView> {
    this.db.transaction((tx) => {
      tx.update(timeZones).set({ name }).where(eq(timeZones.id, id)).run();
      tx.delete(timeRanges).where(eq(timeRanges.timeZoneId, id)).run();
      for (const range of ranges) {
        tx.insert(timeRanges)
          .values({
            timeZoneId: id,
            days: daysToMask(range.days),
            startTime: range.startTime,
            endTime: range.endTime,
          })
          .run();
      }
    });
    return { id, name, timeRanges: this.rangesOf(id) };
  }

  /**
   * Delete a Time Zone and its `time_ranges` rows (Req 5.8). The range rows are
   * removed explicitly within the transaction (the FK also cascades).
   */
  async delete(id: number): Promise<void> {
    this.db.transaction((tx) => {
      tx.delete(timeRanges).where(eq(timeRanges.timeZoneId, id)).run();
      tx.delete(timeZones).where(eq(timeZones.id, id)).run();
    });
  }

  /**
   * Return the subset of `ids` that correspond to existing Time Zones, so the
   * Access Rule service can validate referenced ids (Req 7.2).
   */
  async existingIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = this.db
      .select({ id: timeZones.id })
      .from(timeZones)
      .where(inArray(timeZones.id, ids))
      .all();
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Return the ids of every Access Rule that references this Time Zone, so the
   * service can raise a `409` naming them before allowing a delete (Req 7.7).
   */
  async referencingAccessRules(id: number): Promise<number[]> {
    return this.db
      .select({ accessRuleId: accessRuleTimeZones.accessRuleId })
      .from(accessRuleTimeZones)
      .where(eq(accessRuleTimeZones.timeZoneId, id))
      .all()
      .map((r) => r.accessRuleId);
  }

  /** Load the Time Ranges belonging to a zone, decoded to weekday names. */
  private rangesOf(zoneId: number): TimeRangeView[] {
    return this.db
      .select()
      .from(timeRanges)
      .where(eq(timeRanges.timeZoneId, zoneId))
      .all()
      .map((r) => this.toRangeView(r));
  }

  /** Shape a raw time-range row into a {@link TimeRangeView} (mask → names). */
  private toRangeView(row: {
    id: number;
    days: number;
    startTime: string;
    endTime: string;
  }): TimeRangeView {
    return {
      id: row.id,
      days: maskToDays(row.days),
      startTime: row.startTime,
      endTime: row.endTime,
    };
  }
}
