/**
 * Unit tests for the Drizzle schema and DB connection factory.
 *
 * Verifies (Req 3, 4, 8, 9.1, 9.2):
 *   - Tables are created and usable for both ephemeral (`:memory:`) and
 *     persistent (file) connections — insert + select round-trips.
 *   - A file-backed DB persists rows across a simulated "restart" (close +
 *     reopen the same file).
 *   - `createDb({ mode: 'persistent' })` without a filePath throws clearly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  createDb,
  openConnection,
  createTables,
  type DrizzleDb,
} from './connection.js';
import {
  config,
  users,
  accessLogs,
  sessions,
  interceptionLog,
} from './schema.js';

/** Insert one row into every table and assert it can be read back. */
function exerciseAllTables(db: DrizzleDb): void {
  const now = new Date().toISOString();

  db.insert(config)
    .values({ module: 'monitor', json: '{"hostname":"host"}', updatedAt: now })
    .run();
  const configRows = db.select().from(config).all();
  expect(configRows).toHaveLength(1);
  expect(configRows[0]).toMatchObject({ module: 'monitor' });

  db.insert(users)
    .values({ registration: '0123', name: 'Walter White' })
    .run();
  const userRows = db.select().from(users).all();
  expect(userRows).toHaveLength(1);
  expect(userRows[0]).toMatchObject({ registration: '0123', name: 'Walter White' });
  // Defaults for nullable columns
  expect(userRows[0]?.password).toBeNull();
  expect(userRows[0]?.imagePath).toBeNull();

  db.insert(accessLogs)
    .values({ time: '1532977090', event: '7', deviceId: '478435', userId: '8' })
    .run();
  const logRows = db.select().from(accessLogs).all();
  expect(logRows).toHaveLength(1);
  // Column defaults must be applied
  expect(logRows[0]).toMatchObject({
    event: '7',
    deviceId: '478435',
    userId: '8',
    identifierId: '0',
    portalId: '1',
    identificationRuleId: '0',
    cardValue: '0',
    logTypeId: '-1',
  });

  db.insert(sessions)
    .values({ token: 'tok-abc', issuedAt: 1000, expiresAt: 1000 + 3600_000 })
    .run();
  const sessionRows = db.select().from(sessions).all();
  expect(sessionRows).toHaveLength(1);
  expect(sessionRows[0]).toMatchObject({ token: 'tok-abc', issuedAt: 1000 });

  db.insert(interceptionLog)
    .values({
      direction: 'inbound',
      method: 'POST',
      path: '/login.fcgi',
      timestamp: now,
      body: '{}',
    })
    .run();
  const interceptionRows = db.select().from(interceptionLog).all();
  expect(interceptionRows).toHaveLength(1);
  expect(interceptionRows[0]).toMatchObject({
    direction: 'inbound',
    method: 'POST',
    path: '/login.fcgi',
  });
  // boolean-mode column defaults to false, and nullable columns are null
  expect(interceptionRows[0]?.truncated).toBe(false);
  expect(interceptionRows[0]?.outcome).toBeNull();
  expect(interceptionRows[0]?.statusCode).toBeNull();
}

describe('createDb — ephemeral mode', () => {
  it('creates all tables and supports insert/select for :memory:', () => {
    const db = createDb({ mode: 'ephemeral' });
    exerciseAllTables(db);
    db.$client.close();
  });
});

describe('createDb — persistent mode', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'controlid-db-'));
    filePath = join(dir, 'emulator.sqlite');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates all tables and supports insert/select for a file DB', () => {
    const db = createDb({ mode: 'persistent', filePath });
    exerciseAllTables(db);
    db.$client.close();
  });

  it('round-trips a config row across a close/reopen of the same file', () => {
    // First "boot": write a config row, then close (simulate container stop).
    const first = openConnection({ mode: 'persistent', filePath });
    createTables(first.db);
    const written = new Date().toISOString();
    first.db
      .insert(config)
      .values({
        module: 'monitor',
        json: '{"hostname":"192.168.0.20","port":"8000"}',
        updatedAt: written,
      })
      .run();
    first.close();

    // Second "boot": reopen the SAME file and read the row back.
    const second = openConnection({ mode: 'persistent', filePath });
    createTables(second.db); // idempotent — must not clobber existing data
    const rows = second.db
      .select()
      .from(config)
      .where(eq(config.module, 'monitor'))
      .all();
    second.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      module: 'monitor',
      json: '{"hostname":"192.168.0.20","port":"8000"}',
      updatedAt: written,
    });
  });

  it("throws a clear error when 'persistent' mode is missing filePath", () => {
    expect(() => createDb({ mode: 'persistent' })).toThrow(/filePath/i);
    expect(() => createDb({ mode: 'persistent', filePath: '' })).toThrow(
      /filePath/i,
    );
  });
});

describe('createTables', () => {
  it('is idempotent — calling twice does not throw or drop data', () => {
    const conn = openConnection({ mode: 'ephemeral' });
    createTables(conn.db);
    conn.db.insert(users).values({ registration: 'r1', name: 'A' }).run();
    createTables(conn.db); // second call must be a no-op for existing tables
    const rows = conn.db.select().from(users).all();
    expect(rows).toHaveLength(1);
    conn.close();
  });
});
