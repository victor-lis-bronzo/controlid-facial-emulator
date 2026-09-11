/**
 * `.fcgi` contract and error-handling integration tests (task 12.5).
 *
 * Live-Fastify round-trips via `app.inject()` over a real app backed by an
 * ephemeral DB. Covers:
 *   - login success returns a session (2.1)
 *   - login missing field → 400 naming the field (2.3)
 *   - credential mismatch → 401 (2.2)
 *   - protected route without a session → 401 and not processed (2.5)
 *   - protected route with a valid session is processed (2.4)
 *   - responses carry Content-Type application/json (1.2)
 *   - malformed JSON body → 400 error-description (1.4)
 *   - unknown path → 404 error-description (1.5)
 *   - wrong method on a known route → 405 (1.6)
 *   - set/get_configuration round-trip (3.x)
 *   - create/load_objects incl. empty result (4.1, 4.2) and bad filter → 400 (4.5)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, login, type TestApp } from '../test-helpers.js';

let harness: TestApp | undefined;

afterEach(async () => {
  if (harness !== undefined) {
    await harness.close();
    harness = undefined;
  }
});

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

describe('login / session (.fcgi)', () => {
  it('login success returns a non-empty session (Req 2.1)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/login.fcgi',
      payload: { login: 'admin', password: 'admin' },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const body = response.json() as { session: string };
    expect(typeof body.session).toBe('string');
    expect(body.session.length).toBeGreaterThan(0);
  });

  it('login missing password → 400 naming the field (Req 2.3)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/login.fcgi',
      payload: { login: 'admin' },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as Record<string, string>;
    expect(body['error-description']).toContain('password');
  });

  it('credential mismatch → 401, no session (Req 2.2)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/login.fcgi',
      payload: { login: 'admin', password: 'wrong' },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as Record<string, string>;
    expect(body.session).toBeUndefined();
    expect(body['error-description']).toBeDefined();
  });

  it('session_is_valid reflects a real issued token', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const valid = await harness.app.inject({
      method: 'POST',
      url: '/session_is_valid.fcgi',
      payload: { session: token },
      headers: jsonHeaders(),
    });
    expect(valid.json()).toEqual({ session_is_valid: true });

    const invalid = await harness.app.inject({
      method: 'POST',
      url: '/session_is_valid.fcgi',
      payload: { session: 'not-a-real-token' },
      headers: jsonHeaders(),
    });
    expect(invalid.json()).toEqual({ session_is_valid: false });
  });
});

describe('protected routes require a session (Req 2.4, 2.5)', () => {
  it('protected route without a session → 401 and not processed (Req 2.5)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/get_configuration.fcgi',
      payload: { monitor: ['alive_interval'] },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('protected route with a valid session is processed (Req 2.4)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/get_configuration.fcgi?session=${token}`,
      payload: { monitor: ['alive_interval'] },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('accepts the session token from the body as well as the query', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/get_configuration.fcgi',
      payload: { session: token, monitor: ['alive_interval'] },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('global error / 404 / 405 (Req 1.2, 1.4, 1.5, 1.6)', () => {
  it('malformed JSON body → 400 with error-description (Req 1.4)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/login.fcgi',
      payload: '{ not valid json',
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    const body = response.json() as Record<string, string>;
    expect(body['error-description']).toBeDefined();
  });

  it('unknown path → 404 with error-description (Req 1.5)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/does_not_exist.fcgi',
      payload: {},
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    const body = response.json() as Record<string, string>;
    expect(body['error-description']).toBeDefined();
  });

  it('wrong method on a known route → 405 (Req 1.6)', async () => {
    harness = await buildTestApp();
    // /login.fcgi supports POST only; GET must be a 405.
    const response = await harness.app.inject({ method: 'GET', url: '/login.fcgi' });
    expect(response.statusCode).toBe(405);
  });
});

describe('configuration round-trip (Req 3.1, 3.3)', () => {
  it('set then get returns the written values (stringified)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const setResponse = await harness.app.inject({
      method: 'POST',
      url: `/set_configuration.fcgi?session=${token}`,
      payload: {
        monitor: { hostname: '192.168.0.20', port: '8000', path: 'api/notifications', alive_interval: 45000 },
      },
      headers: jsonHeaders(),
    });
    expect(setResponse.statusCode).toBe(200);
    expect(setResponse.json()).toEqual({});

    const getResponse = await harness.app.inject({
      method: 'POST',
      url: `/get_configuration.fcgi?session=${token}`,
      payload: { monitor: ['hostname', 'port', 'path', 'alive_interval'] },
      headers: jsonHeaders(),
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({
      monitor: {
        hostname: '192.168.0.20',
        port: '8000',
        path: 'api/notifications',
        alive_interval: '45000',
      },
    });
  });

  it('set_configuration with an invalid value → 400 naming the rejected key (Req 3.2)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/set_configuration.fcgi?session=${token}`,
      payload: { monitor: { port: 'not-a-number' } },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as Record<string, string>;
    expect(body['error-description']).toContain('port');
  });
});

describe('objects / logs (Req 4.1, 4.2, 4.5)', () => {
  it('create then load returns the created rows (Req 4.1)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'users',
        values: [{ registration: '0123', name: 'Walter White', password: 'Heisenberg' }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'users' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { users: Record<string, unknown>[] };
    expect(loaded.users.length).toBe(1);
    expect(loaded.users[0].name).toBe('Walter White');
  });

  it('load with no matches returns an empty collection (Req 4.2)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'access_logs' },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ access_logs: [] });
  });

  it('load with an unrecognized filter → 400 naming the parameter (Req 4.5)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'users', where: { not_a_column: 'x' } },
      headers: jsonHeaders(),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as Record<string, string>;
    expect(body['error-description']).toContain('not_a_column');
  });
});

describe('new_user_identified.fcgi (device callback)', () => {
  it('parses x-www-form-urlencoded and returns the Mensagem de Retorno', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/new_user_identified.fcgi',
      payload: 'device_id=478435&event=7&user_id=6&user_name=Neal%20Caffrey&portal_id=1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const body = response.json() as { result: Record<string, unknown> };
    expect(body.result.event).toBe(7);
    expect(body.result.user_id).toBe(6);
    expect(body.result.user_name).toBe('Neal Caffrey');
    expect(Array.isArray(body.result.actions)).toBe(true);
  });
});
