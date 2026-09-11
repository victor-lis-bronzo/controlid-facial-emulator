/**
 * SessionService — issues and validates opaque session tokens for the emulator.
 *
 * Mirrors the device login/session flow (Req 2). On a successful login the
 * service issues a URL-safe random token, persists it to the `sessions` table
 * with its issuance/expiry instants, and later validates a presented token
 * against a fixed 3600-second TTL (Req 2.4, 2.5).
 *
 * The service is intentionally pure — it owns no HTTP concerns. The `.fcgi`
 * routes and session middleware translate `validate()`'s verdict into the
 * appropriate HTTP behavior (200 for `'valid'`, 401 for `'expired'`/`'invalid'`).
 *
 * A `now` clock is injected (default `Date.now`) so tests can advance time
 * across the TTL boundary without real waiting.
 *
 * See design.md → "Components and Interfaces → SessionService", "Data Models →
 * sessions", Requirement 2, and Correctness Property 3.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { sessions } from '../db/schema.js';
import type { SessionToken } from '../shared/index.js';

/** Session validity duration in seconds (Req 2.4, 2.5). */
export const SESSION_TTL_SECONDS = 3600;

/** Session validity duration in milliseconds. */
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

/**
 * Number of random bytes used to generate a token. 24 bytes → 32 base64url
 * characters, comfortably beyond the entropy needed to make tokens
 * unguessable and collision-free in practice.
 */
const TOKEN_BYTES = 24;

/** The outcome of validating a presented token. */
export type SessionValidity = 'valid' | 'expired' | 'invalid';

/** Injectable clock; returns the current instant in epoch milliseconds. */
export type Clock = () => number;

/**
 * Matches only well-formed base64url token strings (the alphabet produced by
 * `randomBytes(...).toString('base64url')`). Anything else is treated as
 * malformed and rejected as `'invalid'` before touching the database.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Issues and validates session tokens against a 3600-second TTL.
 *
 * Construct with the shared {@link DrizzleDb} and, optionally, a `now` clock
 * for testability (defaults to `Date.now`).
 */
export class SessionService {
  /** Session validity duration in seconds (Req 2.4, 2.5). */
  public readonly ttlSeconds = SESSION_TTL_SECONDS;

  private readonly db: DrizzleDb;
  private readonly now: Clock;

  constructor(db: DrizzleDb, now: Clock = Date.now) {
    this.db = db;
    this.now = now;
  }

  /**
   * Issue a fresh session token and persist it.
   *
   * Generates a URL-safe (base64url) random token, computes its issuance and
   * expiry instants (`expiresAt = issuedAt + 3600_000`), stores the row in
   * `sessions`, and returns the {@link SessionToken} (Req 2.1).
   */
  public async issue(): Promise<SessionToken> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const issuedAt = this.now();
    const expiresAt = issuedAt + SESSION_TTL_MS;

    this.db.insert(sessions).values({ token, issuedAt, expiresAt }).run();

    return { token, issuedAt, expiresAt };
  }

  /**
   * Validate a presented session token.
   *
   * - `'invalid'` — the token is absent, empty, malformed, or unknown to the
   *   store (Req 2.5).
   * - `'expired'` — the token exists but the current instant is at or after its
   *   `expiresAt` (i.e. ≥ 3600 s have elapsed since issuance) (Req 2.5).
   * - `'valid'` — the token exists and has not yet expired (Req 2.4).
   */
  public async validate(token: string | undefined): Promise<SessionValidity> {
    if (token === undefined || token === '' || !TOKEN_PATTERN.test(token)) {
      return 'invalid';
    }

    const rows = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.token, token))
      .all();

    const row = rows[0];
    if (row === undefined) {
      return 'invalid';
    }

    if (this.now() >= row.expiresAt) {
      return 'expired';
    }

    return 'valid';
  }

  /**
   * Optional maintenance helper: delete every session whose expiry instant is
   * at or before the current time. Not required by any route, but useful to
   * keep the `sessions` table from growing unbounded.
   *
   * @returns the number of rows removed.
   */
  public async pruneExpired(): Promise<number> {
    const nowMs = this.now();
    const expired = this.db.select().from(sessions).all();
    let removed = 0;
    for (const row of expired) {
      if (nowMs >= row.expiresAt) {
        this.db.delete(sessions).where(eq(sessions.token, row.token)).run();
        removed += 1;
      }
    }
    return removed;
  }
}
