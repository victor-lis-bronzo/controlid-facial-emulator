/**
 * AccessLogRepository — read-only queries over the existing `access_logs` table
 * for the Access Logs view (Req 8) and the Dashboard's recent-logs list
 * (Req 9.2).
 *
 * The table stores the device wire shape; every record is returned as the
 * existing all-string {@link AccessLogRecord} envelope, so the SPA and any
 * client see the same shape as `load_objects.fcgi`. Filters are AND-combined and
 * results are ordered by `time` from most recent to oldest (Req 8.1–8.5). Filter
 * VALUE validation (e.g. a malformed `event`/date) is performed by the route
 * layer; this repository simply applies the supplied predicates.
 *
 * See design.md → "AccessLogRepository".
 */
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { accessLogs } from '../db/schema.js';
import type { AccessLogRecord } from '../shared/index.js';

/** The AND-combined filter accepted by {@link AccessLogRepository.query} (Req 8.2–8.5). */
export interface AccessLogFilter {
  /** Match `user_id` exactly (Req 8.2). */
  userId?: string;
  /** Match `event` exactly — one of the ACCESS_EVENT codes (Req 8.3). */
  event?: string;
  /** Inclusive lower time bound, epoch seconds (Req 8.4). */
  from?: number;
  /** Inclusive upper time bound, epoch seconds (Req 8.4). */
  to?: number;
}

/** A raw `access_logs` row as selected by Drizzle. */
interface AccessLogRow {
  id: number;
  time: string;
  event: string;
  deviceId: string;
  identifierId: string;
  userId: string;
  portalId: string;
  identificationRuleId: string;
  cardValue: string;
  logTypeId: string;
}

export class AccessLogRepository {
  public constructor(private readonly db: DrizzleDb) {}

  /**
   * Return records matching EVERY supplied filter (AND semantics), ordered by
   * `time` from most recent to oldest (Req 8.1–8.5). An empty store or a
   * no-match filter yields `[]` (Req 8.7).
   *
   * The `time` column stores Unix epoch seconds as a string; the `from`/`to`
   * bounds are compared numerically so date-range filtering is correct despite
   * the string storage.
   */
  async query(filter: AccessLogFilter): Promise<AccessLogRecord[]> {
    const conditions: SQL[] = [];
    if (filter.userId !== undefined) {
      conditions.push(eq(accessLogs.userId, filter.userId));
    }
    if (filter.event !== undefined) {
      conditions.push(eq(accessLogs.event, filter.event));
    }
    // The stored `time` is a numeric epoch-seconds string; CAST to integer so
    // range comparisons are numeric, not lexicographic.
    const timeAsInt = sqlTimeAsInt();
    if (filter.from !== undefined) {
      conditions.push(gte(timeAsInt, filter.from));
    }
    if (filter.to !== undefined) {
      conditions.push(lte(timeAsInt, filter.to));
    }

    const where = conditions.length === 0 ? undefined : and(...conditions);
    const rows = this.db
      .select()
      .from(accessLogs)
      .where(where)
      .orderBy(desc(timeAsInt), desc(accessLogs.id))
      .all() as AccessLogRow[];
    return rows.map((row) => this.toRecord(row));
  }

  /**
   * Return the `limit` most-recent records, newest-first (Req 9.2). A non-positive
   * limit yields `[]`.
   */
  async recent(limit: number): Promise<AccessLogRecord[]> {
    if (limit <= 0) {
      return [];
    }
    const timeAsInt = sqlTimeAsInt();
    const rows = this.db
      .select()
      .from(accessLogs)
      .orderBy(desc(timeAsInt), desc(accessLogs.id))
      .limit(limit)
      .all() as AccessLogRow[];
    return rows.map((row) => this.toRecord(row));
  }

  /** Shape a raw row into the all-string device {@link AccessLogRecord} envelope. */
  private toRecord(row: AccessLogRow): AccessLogRecord {
    return {
      id: String(row.id),
      time: row.time,
      event: row.event,
      device_id: row.deviceId,
      identifier_id: row.identifierId,
      user_id: row.userId,
      portal_id: row.portalId,
      identification_rule_id: row.identificationRuleId,
      card_value: row.cardValue,
      log_type_id: row.logTypeId,
    };
  }
}

/**
 * A SQL expression casting the string `time` column to an integer so both range
 * filtering and ordering are numeric (epoch seconds), not lexicographic.
 */
function sqlTimeAsInt(): SQL<number> {
  return sql<number>`CAST(${accessLogs.time} AS INTEGER)`;
}
