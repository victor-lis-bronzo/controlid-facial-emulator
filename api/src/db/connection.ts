/**
 * Database connection factory for the Control-iD Facial Emulator.
 *
 * This module owns the raw SQLite driver (`better-sqlite3`) and wraps it with
 * Drizzle. It supports two operating modes (Req 9.1, 9.2):
 *
 *   - `ephemeral`  → opens an in-memory database (`:memory:`) that is discarded
 *     when the process stops. Intended for CI and tests.
 *   - `persistent` → opens a SQLite file at `filePath`, retained across restarts
 *     when backed by a mounted volume.
 *
 * `schema.ts` is the source of truth for table definitions; the idempotent DDL
 * emitted by `createTables` is kept in sync with it. Raw `CREATE TABLE IF NOT
 * EXISTS` is intentional here: for a single-file embedded DB it is the simplest
 * reliable bootstrap and avoids shipping a migrations runner in the runtime image.
 *
 * See design.md → "Data Models" and "Bootstrap / StateMode selector".
 */
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema.js';

/** State mode selecting where the database is opened. */
export type DbMode = 'ephemeral' | 'persistent';

/** Options accepted by {@link createDb}. */
export interface CreateDbOptions {
  mode: DbMode;
  /** Required when `mode === 'persistent'`; the SQLite file path. */
  filePath?: string;
}

/**
 * The typed Drizzle database used throughout the emulator. Includes the
 * `$client` handle exposed by the better-sqlite3 driver so callers can run raw
 * DDL/pragmas when needed.
 */
export type DrizzleDb = BetterSQLite3Database<typeof schema> & {
  $client: SqliteDatabase;
};

/**
 * A Drizzle database bundled with a handle to its underlying driver, so callers
 * can run raw pragmas/DDL and close the connection deterministically.
 */
export interface Connection {
  db: DrizzleDb;
  sqlite: SqliteDatabase;
  /** Close the underlying SQLite connection. */
  close(): void;
}

/**
 * Idempotent DDL kept in sync with `schema.ts`. Every statement uses
 * `CREATE TABLE IF NOT EXISTS`, so calling it repeatedly on an existing database
 * is safe and never destroys data.
 */
const CREATE_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS config (
    module TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration TEXT NOT NULL,
    name TEXT NOT NULL,
    password TEXT,
    image_path TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    event TEXT NOT NULL,
    device_id TEXT NOT NULL,
    identifier_id TEXT NOT NULL DEFAULT '0',
    user_id TEXT NOT NULL DEFAULT '0',
    portal_id TEXT NOT NULL DEFAULT '1',
    identification_rule_id TEXT NOT NULL DEFAULT '0',
    card_value TEXT NOT NULL DEFAULT '0',
    log_type_id TEXT NOT NULL DEFAULT '-1'
  )`,
  `CREATE TABLE IF NOT EXISTS change_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_type TEXT NOT NULL,
    table_name TEXT NOT NULL,
    table_id TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finger_position TEXT,
    finger_type TEXT NOT NULL,
    template TEXT,
    user_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value TEXT NOT NULL,
    user_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS qrcodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value TEXT NOT NULL,
    user_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS uhf_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value TEXT NOT NULL,
    user_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value TEXT NOT NULL,
    user_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS alarm_zones (
    zone INTEGER PRIMARY KEY,
    enabled TEXT NOT NULL,
    active_level TEXT NOT NULL,
    alarm_delay TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER PRIMARY KEY,
    role TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_unlocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS actions (
    group_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    action TEXT NOT NULL,
    parameters TEXT NOT NULL,
    run_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS time_spans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_zone_id TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    sun TEXT NOT NULL,
    mon TEXT NOT NULL,
    tue TEXT NOT NULL,
    wed TEXT NOT NULL,
    thu TEXT NOT NULL,
    fri TEXT NOT NULL,
    sat TEXT NOT NULL,
    hol1 TEXT NOT NULL,
    hol2 TEXT NOT NULL,
    hol3 TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS interception_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    body TEXT NOT NULL,
    truncated INTEGER NOT NULL DEFAULT 0,
    outcome TEXT,
    status_code INTEGER,
    attempts INTEGER,
    failure_category TEXT
  )`,
  // --- Admin Management Panel additions (strictly additive; kept in sync with
  // schema.ts). Ordered parent-before-child so referenced tables exist first.
  // See design.md → "Data Models → Idempotent DDL additions". ---
  `CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users_groups (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
  )`,
  `CREATE TABLE IF NOT EXISTS portals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS time_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS time_ranges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_zone_id INTEGER NOT NULL REFERENCES time_zones(id) ON DELETE CASCADE,
    days INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_rule_groups (
    access_rule_id INTEGER NOT NULL REFERENCES access_rules(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    PRIMARY KEY (access_rule_id, group_id)
  )`,
  `CREATE TABLE IF NOT EXISTS access_rule_time_zones (
    access_rule_id INTEGER NOT NULL REFERENCES access_rules(id) ON DELETE CASCADE,
    time_zone_id INTEGER NOT NULL REFERENCES time_zones(id) ON DELETE RESTRICT,
    PRIMARY KEY (access_rule_id, time_zone_id)
  )`,
  `CREATE TABLE IF NOT EXISTS access_rule_portals (
    access_rule_id INTEGER NOT NULL REFERENCES access_rules(id) ON DELETE CASCADE,
    portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE RESTRICT,
    PRIMARY KEY (access_rule_id, portal_id)
  )`,
];

/**
 * Create all emulator tables if they do not already exist. Idempotent: safe to
 * call on every startup regardless of whether the database is new or existing.
 */
export function createTables(db: DrizzleDb): void {
  for (const statement of CREATE_TABLE_STATEMENTS) {
    db.$client.exec(statement);
  }
}

/**
 * Open a database connection and wrap it with Drizzle.
 *
 * - `ephemeral` opens an in-memory database (`:memory:`).
 * - `persistent` opens the file at `options.filePath` and enables WAL journaling
 *   and foreign-key enforcement.
 *
 * @throws Error when `mode === 'persistent'` but no `filePath` is supplied.
 */
export function openConnection(options: CreateDbOptions): Connection {
  let sqlite: SqliteDatabase;

  if (options.mode === 'persistent') {
    if (!options.filePath || options.filePath.trim() === '') {
      throw new Error(
        "createDb: 'persistent' mode requires a non-empty 'filePath' option",
      );
    }
    sqlite = new Database(options.filePath);
    // Durability/concurrency tuning appropriate for a file-backed DB.
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
  } else {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
  }

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close(): void {
      sqlite.close();
    },
  };
}

/**
 * Convenience factory: open a connection AND bootstrap the tables, returning the
 * ready-to-use typed Drizzle database. Use {@link openConnection} directly when
 * you need the underlying driver handle or explicit `close()`.
 *
 * @throws Error when `mode === 'persistent'` but no `filePath` is supplied.
 */
export function createDb(options: CreateDbOptions): DrizzleDb {
  const { db } = openConnection(options);
  createTables(db);
  return db;
}
