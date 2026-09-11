/**
 * InterceptionLogger — records inbound `.fcgi` requests and outbound webhook
 * dispatches, enforces body truncation and a bounded capacity, and serves
 * newest-first queries.
 *
 * Behavior (Req 8.1–8.7; design.md → "Components and Interfaces →
 * InterceptionLogger", "Data Models → interception_log"):
 *
 *   - `recordInbound`  stores a received request as an `inbound` record
 *     (Req 8.1). Missing timestamps are generated as ISO 8601 UTC (ms).
 *   - `recordOutbound` stores a dispatched webhook as an `outbound` record with
 *     its outcome/status/attempts/failure category (Req 8.3, 8.4).
 *   - Bodies larger than 64 KB (by UTF-8 byte length) are stored as their first
 *     64 KB and marked `truncated=true` (Req 8.2).
 *   - `query(limit?)` returns records ordered by `id DESC` (newest-first,
 *     Req 8.5); an empty log yields `[]` (Req 8.6 empty-state is a UI concern).
 *   - After every write, if the row count exceeds 10,000 the oldest rows (lowest
 *     ids) are deleted so that exactly 10,000 remain (Req 8.7).
 *
 * This is a pure service: it performs no HTTP and only talks to the database.
 */
import { sql, desc } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { interceptionLog } from '../db/schema.js';
import type { InterceptionLogRow } from '../db/schema.js';
import type {
  InterceptionRecord,
  InterceptionOutcome,
  PushFailureCategory,
} from '../shared/index.js';

/**
 * The recordable fields of an interception entry — an {@link InterceptionRecord}
 * without the DB-assigned `id` and the logger-assigned `direction`. `timestamp`
 * is optional: when omitted the logger generates an ISO 8601 UTC timestamp.
 */
export type InterceptionInput = Omit<
  InterceptionRecord,
  'id' | 'direction' | 'timestamp'
> & { timestamp?: string };

export class InterceptionLogger {
  /** Maximum stored body size in bytes before truncation (64 KB, Req 8.2). */
  public readonly maxBodyBytes = 65_536;

  /** Maximum number of retained records; older ones are discarded (Req 8.7). */
  public readonly capacity = 10_000;

  public constructor(private readonly db: DrizzleDb) {}

  /**
   * Record an inbound `.fcgi` request (Req 8.1, 8.2). Truncates the body to the
   * first 64 KB when it exceeds the limit and enforces the capacity cap.
   */
  public async recordInbound(record: InterceptionInput): Promise<void> {
    await this.insert('inbound', record);
  }

  /**
   * Record an outbound webhook dispatch (Req 8.3, 8.4). Persists the dispatch
   * outcome and, on failure, the failure category and HTTP status code when
   * available. Same truncation and capacity rules as {@link recordInbound}.
   */
  public async recordOutbound(record: InterceptionInput): Promise<void> {
    await this.insert('outbound', record);
  }

  /**
   * Return recorded entries ordered newest-first (`id DESC`, Req 8.5). When
   * `limit` is provided only the newest `limit` records are returned. Returns an
   * empty array when the log is empty (Req 8.6).
   */
  public async query(limit?: number): Promise<InterceptionRecord[]> {
    const base = this.db
      .select()
      .from(interceptionLog)
      .orderBy(desc(interceptionLog.id));
    const rows =
      limit === undefined ? base.all() : base.limit(limit).all();
    return rows.map((row) => this.toRecord(row));
  }

  /** Insert a record with the given direction, then enforce the capacity cap. */
  private async insert(
    direction: 'inbound' | 'outbound',
    record: InterceptionInput,
  ): Promise<void> {
    const { body, truncated } = this.truncateBody(record.body);
    const timestamp = record.timestamp ?? new Date().toISOString();

    this.db
      .insert(interceptionLog)
      .values({
        direction,
        method: record.method,
        path: record.path,
        timestamp,
        body,
        // A caller-supplied `truncated` never suppresses a real truncation.
        truncated: truncated || record.truncated,
        outcome: record.outcome ?? null,
        statusCode: record.statusCode ?? null,
        attempts: record.attempts ?? null,
        failureCategory: record.failureCategory ?? null,
      })
      .run();

    this.enforceCapacity();
  }

  /**
   * Truncate a body to the first {@link maxBodyBytes} bytes measured in UTF-8.
   * Slicing happens on the encoded byte buffer, so the stored prefix is at most
   * 64 KB of bytes even when the input contains multi-byte characters; a partial
   * multi-byte character at the boundary decodes to the Unicode replacement
   * character, which is acceptable per the design.
   */
  private truncateBody(body: string): { body: string; truncated: boolean } {
    const bytes = Buffer.from(body, 'utf8');
    if (bytes.byteLength <= this.maxBodyBytes) {
      return { body, truncated: false };
    }
    const truncatedBody = bytes.subarray(0, this.maxBodyBytes).toString('utf8');
    return { body: truncatedBody, truncated: true };
  }

  /**
   * Delete the oldest rows (lowest ids) so that no more than {@link capacity}
   * records remain (Req 8.7). A no-op when the log is within capacity.
   */
  private enforceCapacity(): void {
    const countRow = this.db
      .select({ value: sql<number>`count(*)` })
      .from(interceptionLog)
      .get();
    const total = countRow?.value ?? 0;
    if (total <= this.capacity) {
      return;
    }

    // Keep the newest `capacity` rows: delete every row whose id is below the
    // id of the newest-of-the-retained window.
    const threshold = this.db
      .select({ id: interceptionLog.id })
      .from(interceptionLog)
      .orderBy(desc(interceptionLog.id))
      .limit(1)
      .offset(this.capacity - 1)
      .get();
    if (threshold === undefined) {
      return;
    }

    this.db
      .delete(interceptionLog)
      .where(sql`${interceptionLog.id} < ${threshold.id}`)
      .run();
  }

  /**
   * Map a raw DB row to the shared {@link InterceptionRecord} shape: booleanize
   * `truncated` and coerce nullable columns to `undefined` where the record type
   * treats the field as optional.
   */
  private toRecord(row: InterceptionLogRow): InterceptionRecord {
    return {
      id: row.id,
      direction: row.direction as InterceptionRecord['direction'],
      method: row.method,
      path: row.path,
      timestamp: row.timestamp,
      body: row.body,
      truncated: Boolean(row.truncated),
      outcome:
        row.outcome === null
          ? undefined
          : (row.outcome as InterceptionOutcome),
      statusCode: row.statusCode ?? undefined,
      attempts: row.attempts ?? undefined,
      failureCategory:
        row.failureCategory === null
          ? undefined
          : (row.failureCategory as PushFailureCategory),
    };
  }
}
