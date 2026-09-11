/**
 * Integration test for the inbound interception tap (task 11.2).
 *
 * Verifies that an inbound request to an interceptable path is recorded by the
 * InterceptionLogger with the path, HTTP method, an ISO-8601 UTC millisecond
 * timestamp, and the request body (Req 8.1). Driven via `app.inject()` over a
 * real built app backed by an ephemeral (`:memory:`) DB.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { buildContainer, type Container } from './container.js';
import { buildApp } from './app.js';
import type { ResolvedConfig } from './bootstrap.js';

const RESOLVED: ResolvedConfig = {
  mode: 'ephemeral',
  dbPath: ':memory:',
  port: 0,
  deviceId: 478435,
  login: 'admin',
  password: 'admin',
  warnings: [],
};

/** No-network push client + no-op sleep so nothing ever hits the timeout/retry path. */
const noopOverrides = {
  pushHttpPost: async () => ({ statusCode: 200 }),
  pushSleep: async () => {},
};

let app: FastifyInstance | undefined;
let db: DrizzleDb | undefined;

function build(): { app: Promise<FastifyInstance>; container: Container; db: DrizzleDb } {
  db = createDb({ mode: 'ephemeral' });
  const container = buildContainer(db, RESOLVED, noopOverrides);
  return { app: buildApp(container, RESOLVED), container, db };
}

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
  if (db !== undefined) {
    db.$client.close();
    db = undefined;
  }
});

describe('inbound interception tap (Req 8.1)', () => {
  it('records path, method, ISO-8601 ms timestamp, and body for a .fcgi request', async () => {
    const built = build();
    app = await built.app;
    const container = built.container;

    const body = { session: 'whatever' };
    const before = Date.now();
    await app.inject({
      method: 'POST',
      url: '/session_is_valid.fcgi',
      payload: body,
      headers: { 'content-type': 'application/json' },
    });
    const after = Date.now();

    const records = await container.logger.query();
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record.direction).toBe('inbound');
    expect(record.method).toBe('POST');
    expect(record.path).toBe('/session_is_valid.fcgi');
    expect(record.body).toBe(JSON.stringify(body));

    // ISO 8601 UTC with millisecond precision, e.g. 2024-01-01T00:00:00.000Z.
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const ts = Date.parse(record.timestamp);
    expect(ts).toBeGreaterThanOrEqual(before - 1);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it('records the body even when the request fails validation (4xx)', async () => {
    const built = build();
    app = await built.app;
    const container = built.container;

    // login missing password → 400, but the body must still be recorded.
    const body = { login: 'admin' };
    const response = await app.inject({
      method: 'POST',
      url: '/login.fcgi',
      payload: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);

    const records = await container.logger.query();
    expect(records.length).toBe(1);
    expect(records[0].path).toBe('/login.fcgi');
    expect(records[0].body).toBe(JSON.stringify(body));
  });

  it('records inbound /api requests as well as .fcgi', async () => {
    const built = build();
    app = await built.app;
    const container = built.container;

    await app.inject({ method: 'GET', url: '/api/identities' });

    const records = await container.logger.query();
    expect(records.some((r) => r.path === '/api/identities' && r.method === 'GET')).toBe(true);
  });
});
