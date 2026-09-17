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
import {
  buildTestApp,
  jpegBytes,
  login,
  multipartFile,
  pngBytes,
  type TestApp,
} from '../test-helpers.js';

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

  it('change_logs: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'change_logs',
        values: [
          { operation_type: 'insert', table_name: 'users', table_id: '1', timestamp: '1000' },
        ],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'change_logs' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { change_logs: Record<string, unknown>[] };
    expect(loaded.change_logs.length).toBe(1);
    expect(loaded.change_logs[0].table_name).toBe('users');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: {
        object: 'change_logs',
        values: { operation_type: 'update' },
        where: { table_name: 'users' },
      },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'change_logs', where: { table_name: 'users' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'change_logs' },
      headers: jsonHeaders(),
    });
    expect(finalLoad.json()).toEqual({ change_logs: [] });
  });

  it('templates: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'templates',
        values: [{ finger_type: '0', template: 'YmFzZTY0', user_id: '1' }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'templates' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { templates: Record<string, unknown>[] };
    expect(loaded.templates.length).toBe(1);
    expect(loaded.templates[0].user_id).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: {
        object: 'templates',
        values: { finger_type: '1' },
        where: { user_id: '1' },
      },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'templates', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'templates' },
      headers: jsonHeaders(),
    });
    expect(finalLoad.json()).toEqual({ templates: [] });
  });

  it('cards: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'cards', values: [{ value: '123456', user_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'cards' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { cards: Record<string, unknown>[] };
    expect(loaded.cards.length).toBe(1);
    expect(loaded.cards[0].value).toBe('123456');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'cards', values: { value: '654321' }, where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'cards', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'cards' },
      headers: jsonHeaders(),
    });
    expect(finalLoad.json()).toEqual({ cards: [] });
  });

  it('qrcodes: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'qrcodes', values: [{ value: 'qr-abc', user_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'qrcodes' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { qrcodes: Record<string, unknown>[] };
    expect(loaded.qrcodes.length).toBe(1);
    expect(loaded.qrcodes[0].value).toBe('qr-abc');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'qrcodes', values: { value: 'qr-xyz' }, where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'qrcodes', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad2 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'qrcodes' },
      headers: jsonHeaders(),
    });
    expect(finalLoad2.json()).toEqual({ qrcodes: [] });
  });

  it('uhf_tags: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'uhf_tags', values: [{ value: 'tag-abc', user_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'uhf_tags' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { uhf_tags: Record<string, unknown>[] };
    expect(loaded.uhf_tags.length).toBe(1);
    expect(loaded.uhf_tags[0].value).toBe('tag-abc');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'uhf_tags', values: { value: 'tag-xyz' }, where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'uhf_tags', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad3 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'uhf_tags' },
      headers: jsonHeaders(),
    });
    expect(finalLoad3.json()).toEqual({ uhf_tags: [] });
  });

  it('pins: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'pins', values: [{ value: '1234', user_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'pins' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { pins: Record<string, unknown>[] };
    expect(loaded.pins.length).toBe(1);
    expect(loaded.pins[0].value).toBe('1234');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'pins', values: { value: '9999' }, where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'pins', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad4 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'pins' },
      headers: jsonHeaders(),
    });
    expect(finalLoad4.json()).toEqual({ pins: [] });
  });

  it('alarm_zones: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'alarm_zones',
        values: [{ zone: '1', enabled: '1', active_level: '1', alarm_delay: '0' }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids).toEqual([1]);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zones' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { alarm_zones: Record<string, unknown>[] };
    expect(loaded.alarm_zones.length).toBe(1);
    expect(loaded.alarm_zones[0].zone).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zones', values: { enabled: '0' }, where: { zone: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zones', where: { zone: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad5 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zones' },
      headers: jsonHeaders(),
    });
    expect(finalLoad5.json()).toEqual({ alarm_zones: [] });
  });

  it('user_roles: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'user_roles', values: [{ user_id: '1', role: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids).toEqual([1]);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'user_roles' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { user_roles: Record<string, unknown>[] };
    expect(loaded.user_roles.length).toBe(1);
    expect(loaded.user_roles[0].role).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'user_roles', values: { role: '0' }, where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'user_roles', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad6 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'user_roles' },
      headers: jsonHeaders(),
    });
    expect(finalLoad6.json()).toEqual({ user_roles: [] });
  });

  it('scheduled_unlocks: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'scheduled_unlocks', values: [{ name: 'Lunch break' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'scheduled_unlocks' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { scheduled_unlocks: Record<string, unknown>[] };
    expect(loaded.scheduled_unlocks.length).toBe(1);
    expect(loaded.scheduled_unlocks[0].name).toBe('Lunch break');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: {
        object: 'scheduled_unlocks',
        values: { message: 'Updated' },
        where: { name: 'Lunch break' },
      },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'scheduled_unlocks', where: { name: 'Lunch break' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad7 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'scheduled_unlocks' },
      headers: jsonHeaders(),
    });
    expect(finalLoad7.json()).toEqual({ scheduled_unlocks: [] });
  });

  it('actions: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'actions',
        values: [{ group_id: '1', name: 'Open door', action: 'open.sh', parameters: '', run_at: '0' }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids).toEqual([1]);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'actions' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { actions: Record<string, unknown>[] };
    expect(loaded.actions.length).toBe(1);
    expect(loaded.actions[0].name).toBe('Open door');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'actions', values: { run_at: '2' }, where: { group_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'actions', where: { group_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad8 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'actions' },
      headers: jsonHeaders(),
    });
    expect(finalLoad8.json()).toEqual({ actions: [] });
  });

  it('areas: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'areas', values: [{ name: 'Warehouse' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'areas' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { areas: Record<string, unknown>[] };
    expect(loaded.areas.length).toBe(1);
    expect(loaded.areas[0].name).toBe('Warehouse');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'areas', values: { name: 'HQ' }, where: { name: 'Warehouse' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'areas', where: { name: 'HQ' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad9 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'areas' },
      headers: jsonHeaders(),
    });
    expect(finalLoad9.json()).toEqual({ areas: [] });
  });

  it('time_spans: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const span = {
      time_zone_id: '1',
      start: '0',
      end: '3600',
      sun: '1',
      mon: '1',
      tue: '1',
      wed: '1',
      thu: '1',
      fri: '1',
      sat: '1',
      hol1: '0',
      hol2: '0',
      hol3: '0',
    };

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'time_spans', values: [span] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'time_spans' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { time_spans: Record<string, unknown>[] };
    expect(loaded.time_spans.length).toBe(1);
    expect(loaded.time_spans[0].time_zone_id).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'time_spans', values: { end: '7200' }, where: { time_zone_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'time_spans', where: { time_zone_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad10 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'time_spans' },
      headers: jsonHeaders(),
    });
    expect(finalLoad10.json()).toEqual({ time_spans: [] });
  });

  it('contingency_cards: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_cards', values: [{ value: '123456' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_cards' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { contingency_cards: Record<string, unknown>[] };
    expect(loaded.contingency_cards.length).toBe(1);
    expect(loaded.contingency_cards[0].value).toBe('123456');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: {
        object: 'contingency_cards',
        values: { value: '654321' },
        where: { value: '123456' },
      },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_cards', where: { value: '654321' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad11 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_cards' },
      headers: jsonHeaders(),
    });
    expect(finalLoad11.json()).toEqual({ contingency_cards: [] });
  });

  it('holidays: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const holiday = {
      name: 'New Year',
      start: '0',
      end: '86400',
      hol1: '1',
      hol2: '0',
      hol3: '0',
      repeats: '1',
    };

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'holidays', values: [holiday] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'holidays' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { holidays: Record<string, unknown>[] };
    expect(loaded.holidays.length).toBe(1);
    expect(loaded.holidays[0].name).toBe('New Year');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'holidays', values: { repeats: '0' }, where: { name: 'New Year' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'holidays', where: { name: 'New Year' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad12 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'holidays' },
      headers: jsonHeaders(),
    });
    expect(finalLoad12.json()).toEqual({ holidays: [] });
  });

  it('alarm_logs: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_logs', values: [{ event: '1', cause: '3', time: '1000' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_logs' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { alarm_logs: Record<string, unknown>[] };
    expect(loaded.alarm_logs.length).toBe(1);
    expect(loaded.alarm_logs[0].cause).toBe('3');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_logs', values: { cause: '9' }, where: { event: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_logs', where: { event: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad13 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_logs' },
      headers: jsonHeaders(),
    });
    expect(finalLoad13.json()).toEqual({ alarm_logs: [] });
  });

  it('devices: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'devices', values: [{ name: 'Front door', ip: '192.168.0.10' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'devices' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { devices: Record<string, unknown>[] };
    expect(loaded.devices.length).toBe(1);
    expect(loaded.devices[0].name).toBe('Front door');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'devices', values: { ip: '10.0.0.1' }, where: { name: 'Front door' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'devices', where: { name: 'Front door' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad14 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'devices' },
      headers: jsonHeaders(),
    });
    expect(finalLoad14.json()).toEqual({ devices: [] });
  });

  it('catra_infos: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'catra_infos', values: [{ left_turns: '10' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'catra_infos' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { catra_infos: Record<string, unknown>[] };
    expect(loaded.catra_infos.length).toBe(1);
    expect(loaded.catra_infos[0].left_turns).toBe('10');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'catra_infos', values: { left_turns: '20' }, where: { left_turns: '10' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'catra_infos', where: { left_turns: '20' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad15 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'catra_infos' },
      headers: jsonHeaders(),
    });
    expect(finalLoad15.json()).toEqual({ catra_infos: [] });
  });

  it('log_types: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'log_types', values: [{ name: 'Access Granted' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'log_types' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { log_types: Record<string, unknown>[] };
    expect(loaded.log_types.length).toBe(1);
    expect(loaded.log_types[0].name).toBe('Access Granted');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'log_types', values: { name: 'Granted' }, where: { name: 'Access Granted' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'log_types', where: { name: 'Granted' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad16 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'log_types' },
      headers: jsonHeaders(),
    });
    expect(finalLoad16.json()).toEqual({ log_types: [] });
  });

  it('sec_boxs: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'sec_boxs', values: [{ id: '65793', name: 'SecBox 1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids).toEqual([65793]);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'sec_boxs' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { sec_boxs: Record<string, unknown>[] };
    expect(loaded.sec_boxs.length).toBe(1);
    expect(loaded.sec_boxs[0].name).toBe('SecBox 1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'sec_boxs', values: { enabled: '1' }, where: { id: '65793' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'sec_boxs', where: { id: '65793' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad17 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'sec_boxs' },
      headers: jsonHeaders(),
    });
    expect(finalLoad17.json()).toEqual({ sec_boxs: [] });
  });

  it('contacts: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'contacts', values: [{ name: 'Security', number: '911' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'contacts' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { contacts: Record<string, unknown>[] };
    expect(loaded.contacts.length).toBe(1);
    expect(loaded.contacts[0].name).toBe('Security');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'contacts', values: { number: '100' }, where: { name: 'Security' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'contacts', where: { name: 'Security' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad18 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'contacts' },
      headers: jsonHeaders(),
    });
    expect(finalLoad18.json()).toEqual({ contacts: [] });
  });

  it('timed_alarms: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const alarm = {
      name: 'Morning bell',
      start: '28800',
      sun: '0',
      mon: '1',
      tue: '1',
      wed: '1',
      thu: '1',
      fri: '1',
      sat: '0',
    };

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'timed_alarms', values: [alarm] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'timed_alarms' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { timed_alarms: Record<string, unknown>[] };
    expect(loaded.timed_alarms.length).toBe(1);
    expect(loaded.timed_alarms[0].name).toBe('Morning bell');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'timed_alarms', values: { start: '72000' }, where: { name: 'Morning bell' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'timed_alarms', where: { name: 'Morning bell' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad19 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'timed_alarms' },
      headers: jsonHeaders(),
    });
    expect(finalLoad19.json()).toEqual({ timed_alarms: [] });
  });

  it('access_events: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);
    const event = { event: 'door', type: 'OPEN', identification: 'd1', device_id: '1', timestamp: '1000' };

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'access_events', values: [event] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'access_events' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { access_events: Record<string, unknown>[] };
    expect(loaded.access_events.length).toBe(1);
    expect(loaded.access_events[0].type).toBe('OPEN');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'access_events', values: { type: 'CLOSE' }, where: { event: 'door' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'access_events', where: { event: 'door' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad20 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'access_events' },
      headers: jsonHeaders(),
    });
    expect(finalLoad20.json()).toEqual({ access_events: [] });
  });

  it('custom_thresholds: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'custom_thresholds', values: [{ user_id: '1', threshold: '50' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'custom_thresholds' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { custom_thresholds: Record<string, unknown>[] };
    expect(loaded.custom_thresholds.length).toBe(1);
    expect(loaded.custom_thresholds[0].threshold).toBe('50');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'custom_thresholds', values: { threshold: '90' }, where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'custom_thresholds', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad21 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'custom_thresholds' },
      headers: jsonHeaders(),
    });
    expect(finalLoad21.json()).toEqual({ custom_thresholds: [] });
  });

  it('user_groups: full create → load → modify → destroy cycle (reuses users_groups)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const userCreate = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'users', values: [{ registration: '1', name: 'A' }] },
      headers: jsonHeaders(),
    });
    const userId = (userCreate.json() as { ids: number[] }).ids[0];

    const groupResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${token}`,
      payload: { name: 'G1' },
      headers: jsonHeaders(),
    });
    const groupId = (groupResponse.json() as { id: number }).id;

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'user_groups',
        values: [{ user_id: String(userId), group_id: String(groupId) }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'user_groups' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { user_groups: Record<string, unknown>[] };
    expect(loaded.user_groups.length).toBe(1);
    expect(loaded.user_groups[0].group_id).toBe(String(groupId));

    // visible from the admin-panel too — same underlying table
    const groupView = await harness.app.inject({
      method: 'GET',
      url: `/api/admin/groups/${groupId}`,
    });
    expect((groupView.json() as { members: unknown[] }).members).toHaveLength(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'user_groups', where: { group_id: String(groupId) } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad22 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'user_groups' },
      headers: jsonHeaders(),
    });
    expect(finalLoad22.json()).toEqual({ user_groups: [] });
  });

  it('portal_access_rules: full create → load → modify → destroy cycle (reuses access_rule_portals)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const portalResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/portals?session=${token}`,
      payload: { name: 'P1' },
      headers: jsonHeaders(),
    });
    const portalId = (portalResponse.json() as { id: number }).id;

    // A second portal satisfies the access rule's mandatory portalIds (Req
    // 7.3) without pre-associating portalId, so the .fcgi create below
    // still starts fresh for that (access_rule_id, portal_id) pair.
    const otherPortalResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/portals?session=${token}`,
      payload: { name: 'P2' },
      headers: jsonHeaders(),
    });
    const otherPortalId = (otherPortalResponse.json() as { id: number }).id;

    const groupResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${token}`,
      payload: { name: 'G1' },
      headers: jsonHeaders(),
    });
    const groupId = (groupResponse.json() as { id: number }).id;

    const timeZoneResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/time-zones?session=${token}`,
      payload: { name: 'TZ1', timeRanges: [{ days: ['mon'], startTime: '09:00', endTime: '17:00' }] },
      headers: jsonHeaders(),
    });
    const timeZoneId = (timeZoneResponse.json() as { id: number }).id;

    // groupIds/timeZoneIds/portalIds must each be non-empty (Req 7.3) for
    // the access rule itself to be created.
    const ruleResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/access-rules?session=${token}`,
      payload: { name: 'R1', groupIds: [groupId], timeZoneIds: [timeZoneId], portalIds: [otherPortalId] },
      headers: jsonHeaders(),
    });
    const ruleId = (ruleResponse.json() as { id: number }).id;

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'portal_access_rules',
        values: [{ portal_id: String(portalId), access_rule_id: String(ruleId) }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'portal_access_rules', where: { portal_id: String(portalId) } },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { portal_access_rules: Record<string, unknown>[] };
    expect(loaded.portal_access_rules.length).toBe(1);
    expect(loaded.portal_access_rules[0].access_rule_id).toBe(String(ruleId));

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'portal_access_rules', where: { portal_id: String(portalId) } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad23 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'portal_access_rules', where: { portal_id: String(portalId) } },
      headers: jsonHeaders(),
    });
    expect(finalLoad23.json()).toEqual({ portal_access_rules: [] });
  });

  it('group_access_rules: full create → load → modify → destroy cycle (reuses access_rule_groups)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const groupResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${token}`,
      payload: { name: 'G1' },
      headers: jsonHeaders(),
    });
    const groupId = (groupResponse.json() as { id: number }).id;

    // A second group satisfies the access rule's mandatory groupIds (Req
    // 7.3) without pre-associating groupId, so the .fcgi create below still
    // starts fresh for that (access_rule_id, group_id) pair.
    const otherGroupResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${token}`,
      payload: { name: 'G2' },
      headers: jsonHeaders(),
    });
    const otherGroupId = (otherGroupResponse.json() as { id: number }).id;

    const portalResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/portals?session=${token}`,
      payload: { name: 'P1' },
      headers: jsonHeaders(),
    });
    const portalId = (portalResponse.json() as { id: number }).id;

    const timeZoneResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/time-zones?session=${token}`,
      payload: { name: 'TZ1', timeRanges: [{ days: ['mon'], startTime: '09:00', endTime: '17:00' }] },
      headers: jsonHeaders(),
    });
    const timeZoneId = (timeZoneResponse.json() as { id: number }).id;

    // groupIds/timeZoneIds/portalIds must each be non-empty (Req 7.3) for
    // the access rule itself to be created.
    const ruleResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/access-rules?session=${token}`,
      payload: { name: 'R1', groupIds: [otherGroupId], timeZoneIds: [timeZoneId], portalIds: [portalId] },
      headers: jsonHeaders(),
    });
    const ruleId = (ruleResponse.json() as { id: number }).id;

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'group_access_rules',
        values: [{ group_id: String(groupId), access_rule_id: String(ruleId) }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'group_access_rules', where: { group_id: String(groupId) } },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { group_access_rules: Record<string, unknown>[] };
    expect(loaded.group_access_rules.length).toBe(1);
    expect(loaded.group_access_rules[0].access_rule_id).toBe(String(ruleId));

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'group_access_rules', where: { group_id: String(groupId) } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad24 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'group_access_rules', where: { group_id: String(groupId) } },
      headers: jsonHeaders(),
    });
    expect(finalLoad24.json()).toEqual({ group_access_rules: [] });
  });

  it('access_rule_time_zones: full create → load → modify → destroy cycle (reuses access_rule_time_zones)', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const timeZoneResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/time-zones?session=${token}`,
      payload: { name: 'TZ1', timeRanges: [{ days: ['mon'], startTime: '09:00', endTime: '17:00' }] },
      headers: jsonHeaders(),
    });
    const timeZoneId = (timeZoneResponse.json() as { id: number }).id;

    // A second time zone satisfies the access rule's mandatory timeZoneIds
    // (Req 7.3) without pre-associating timeZoneId, so the .fcgi create
    // below still starts fresh for that (access_rule_id, time_zone_id) pair.
    const otherTimeZoneResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/time-zones?session=${token}`,
      payload: { name: 'TZ2', timeRanges: [{ days: ['tue'], startTime: '09:00', endTime: '17:00' }] },
      headers: jsonHeaders(),
    });
    const otherTimeZoneId = (otherTimeZoneResponse.json() as { id: number }).id;

    const groupResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${token}`,
      payload: { name: 'G1' },
      headers: jsonHeaders(),
    });
    const groupId = (groupResponse.json() as { id: number }).id;

    const portalResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/portals?session=${token}`,
      payload: { name: 'P1' },
      headers: jsonHeaders(),
    });
    const portalId = (portalResponse.json() as { id: number }).id;

    // groupIds/timeZoneIds/portalIds must each be non-empty (Req 7.3) for
    // the access rule itself to be created.
    const ruleResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/admin/access-rules?session=${token}`,
      payload: {
        name: 'R1',
        groupIds: [groupId],
        timeZoneIds: [otherTimeZoneId],
        portalIds: [portalId],
      },
      headers: jsonHeaders(),
    });
    const ruleId = (ruleResponse.json() as { id: number }).id;

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: {
        object: 'access_rule_time_zones',
        values: [{ access_rule_id: String(ruleId), time_zone_id: String(timeZoneId) }],
      },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'access_rule_time_zones', where: { time_zone_id: String(timeZoneId) } },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { access_rule_time_zones: Record<string, unknown>[] };
    expect(loaded.access_rule_time_zones.length).toBe(1);
    expect(loaded.access_rule_time_zones[0].access_rule_id).toBe(String(ruleId));

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'access_rule_time_zones', where: { time_zone_id: String(timeZoneId) } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad25 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'access_rule_time_zones', where: { time_zone_id: String(timeZoneId) } },
      headers: jsonHeaders(),
    });
    expect(finalLoad25.json()).toEqual({ access_rule_time_zones: [] });
  });

  it('user_access_rules: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'user_access_rules', values: [{ user_id: '1', access_rule_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'user_access_rules' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { user_access_rules: Record<string, unknown>[] };
    expect(loaded.user_access_rules.length).toBe(1);
    expect(loaded.user_access_rules[0].access_rule_id).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'user_access_rules', values: { access_rule_id: '2' }, where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'user_access_rules', where: { user_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad26 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'user_access_rules' },
      headers: jsonHeaders(),
    });
    expect(finalLoad26.json()).toEqual({ user_access_rules: [] });
  });

  it('access_log_access_rules: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'access_log_access_rules', values: [{ access_log_id: '1', access_rule_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'access_log_access_rules' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { access_log_access_rules: Record<string, unknown>[] };
    expect(loaded.access_log_access_rules.length).toBe(1);
    expect(loaded.access_log_access_rules[0].access_rule_id).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: {
        object: 'access_log_access_rules',
        values: { access_rule_id: '2' },
        where: { access_log_id: '1' },
      },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'access_log_access_rules', where: { access_log_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad27 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'access_log_access_rules' },
      headers: jsonHeaders(),
    });
    expect(finalLoad27.json()).toEqual({ access_log_access_rules: [] });
  });

  it('portal_actions: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'portal_actions', values: [{ portal_id: '1', action_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'portal_actions' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { portal_actions: Record<string, unknown>[] };
    expect(loaded.portal_actions.length).toBe(1);
    expect(loaded.portal_actions[0].action_id).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: { object: 'portal_actions', values: { action_id: '2' }, where: { portal_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'portal_actions', where: { portal_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad28 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'portal_actions' },
      headers: jsonHeaders(),
    });
    expect(finalLoad28.json()).toEqual({ portal_actions: [] });
  });

  it('alarm_zone_time_zones: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zone_time_zones', values: [{ alarm_zone_id: '1', time_zone_id: '1' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zone_time_zones' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { alarm_zone_time_zones: Record<string, unknown>[] };
    expect(loaded.alarm_zone_time_zones.length).toBe(1);
    expect(loaded.alarm_zone_time_zones[0].time_zone_id).toBe('1');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: {
        object: 'alarm_zone_time_zones',
        values: { time_zone_id: '2' },
        where: { alarm_zone_id: '1' },
      },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zone_time_zones', where: { alarm_zone_id: '1' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad29 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'alarm_zone_time_zones' },
      headers: jsonHeaders(),
    });
    expect(finalLoad29.json()).toEqual({ alarm_zone_time_zones: [] });
  });

  it('contingency_card_access_rules: full create → load → modify → destroy cycle', async () => {
    harness = await buildTestApp();
    const token = await login(harness.app);

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: `/create_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_card_access_rules', values: [{ access_rule_id: '5' }] },
      headers: jsonHeaders(),
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as { ids: number[] };
    expect(created.ids.length).toBe(1);

    const loadResponse = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_card_access_rules' },
      headers: jsonHeaders(),
    });
    expect(loadResponse.statusCode).toBe(200);
    const loaded = loadResponse.json() as { contingency_card_access_rules: Record<string, unknown>[] };
    expect(loaded.contingency_card_access_rules.length).toBe(1);
    expect(loaded.contingency_card_access_rules[0].access_rule_id).toBe('5');

    const modifyResponse = await harness.app.inject({
      method: 'POST',
      url: `/modify_objects.fcgi?session=${token}`,
      payload: {
        object: 'contingency_card_access_rules',
        values: { access_rule_id: '6' },
        where: { access_rule_id: '5' },
      },
      headers: jsonHeaders(),
    });
    expect(modifyResponse.statusCode).toBe(200);
    expect((modifyResponse.json() as { changes: number }).changes).toBe(1);

    const destroyResponse = await harness.app.inject({
      method: 'POST',
      url: `/destroy_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_card_access_rules', where: { access_rule_id: '6' } },
      headers: jsonHeaders(),
    });
    expect(destroyResponse.statusCode).toBe(200);
    expect((destroyResponse.json() as { changes: number }).changes).toBe(1);

    const finalLoad30 = await harness.app.inject({
      method: 'POST',
      url: `/load_objects.fcgi?session=${token}`,
      payload: { object: 'contingency_card_access_rules' },
      headers: jsonHeaders(),
    });
    expect(finalLoad30.json()).toEqual({ contingency_card_access_rules: [] });
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

describe(
  'Facial photo (.fcgi) - user_set_image / user_get_image / ' +
    'user_destroy_image (Issue #26)',
  () => {
    async function createUser(h: TestApp, token: string): Promise<number> {
      const response = await h.app.inject({
        method: 'POST',
        url: `/create_objects.fcgi?session=${token}`,
        payload: {
          object: 'users',
          values: [{ registration: '9001', name: 'Face User', password: '1234' }],
        },
        headers: jsonHeaders(),
      });
      const created = response.json() as { ids: number[] };
      return created.ids[0];
    }

    it('uploads a JPEG then round-trips it via user_get_image.fcgi', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const bytes = jpegBytes();
      const { payload, headers } = multipartFile(bytes, 'face.jpg', 'image/jpeg', {
        user_id: String(userId),
      });
      const uploadResponse = await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });
      expect(uploadResponse.statusCode).toBe(200);
      expect(uploadResponse.json()).toEqual({ success: true });

      const getResponse = await harness.app.inject({
        method: 'GET',
        url: `/user_get_image.fcgi?user_id=${String(userId)}&session=${token}`,
      });
      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.from(getResponse.rawPayload).equals(bytes)).toBe(true);
    });

    it('uploads a PNG then round-trips it via user_get_image.fcgi', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const bytes = pngBytes();
      const { payload, headers } = multipartFile(bytes, 'face.png', 'image/png', {
        user_id: String(userId),
      });
      const uploadResponse = await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });
      expect(uploadResponse.statusCode).toBe(200);

      const getResponse = await harness.app.inject({
        method: 'GET',
        url: `/user_get_image.fcgi?user_id=${String(userId)}&session=${token}`,
      });
      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.headers['content-type']).toContain('image/png');
      expect(Buffer.from(getResponse.rawPayload).equals(bytes)).toBe(true);
    });

    it('user_get_image.fcgi for a freshly-created user with no photo → 404', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const response = await harness.app.inject({
        method: 'GET',
        url: `/user_get_image.fcgi?user_id=${String(userId)}&session=${token}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('user_destroy_image.fcgi removes the photo; subsequent GET → 404', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const { payload, headers } = multipartFile(jpegBytes(), 'face.jpg', 'image/jpeg', {
        user_id: String(userId),
      });
      await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });

      const destroyResponse = await harness.app.inject({
        method: 'POST',
        url: `/user_destroy_image.fcgi?session=${token}`,
        payload: { user_id: userId },
        headers: jsonHeaders(),
      });
      expect(destroyResponse.statusCode).toBe(200);
      expect(destroyResponse.json()).toEqual({ success: true });

      const getResponse = await harness.app.inject({
        method: 'GET',
        url: `/user_get_image.fcgi?user_id=${String(userId)}&session=${token}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('user_set_image.fcgi with a disallowed declared MIME → 400', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const { payload, headers } = multipartFile(jpegBytes(), 'face.gif', 'image/gif', {
        user_id: String(userId),
      });
      const response = await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as Record<string, string>;
      expect(body['error-description']).toContain('JPEG, PNG');
    });

    it('user_set_image.fcgi with declared/actual MIME mismatch (magic-byte sniff) → 400', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      // Declares image/jpeg but sends PNG magic bytes.
      const { payload, headers } = multipartFile(pngBytes(), 'face.jpg', 'image/jpeg', {
        user_id: String(userId),
      });
      const response = await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('user_set_image.fcgi with a payload over 5 MB → 413', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const { payload, headers } = multipartFile(
        jpegBytes(6 * 1024 * 1024),
        'face.jpg',
        'image/jpeg',
        { user_id: String(userId) },
      );
      const response = await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });
      expect(response.statusCode).toBe(413);
      const body = response.json() as Record<string, string>;
      expect(body['error-description']).toContain('5 MB');
    });

    it('user_set_image.fcgi / user_destroy_image.fcgi without a session → 401', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const { payload, headers } = multipartFile(jpegBytes(), 'face.jpg', 'image/jpeg', {
        user_id: String(userId),
      });
      const uploadResponse = await harness.app.inject({
        method: 'POST',
        url: '/user_set_image.fcgi',
        payload,
        headers,
      });
      expect(uploadResponse.statusCode).toBe(401);

      const destroyResponse = await harness.app.inject({
        method: 'POST',
        url: '/user_destroy_image.fcgi',
        payload: { user_id: userId },
        headers: jsonHeaders(),
      });
      expect(destroyResponse.statusCode).toBe(401);
    });

    it('user_set_image.fcgi / user_destroy_image.fcgi for a non-existent user_id → 404', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);

      const { payload, headers } = multipartFile(jpegBytes(), 'face.jpg', 'image/jpeg', {
        user_id: '999999',
      });
      const uploadResponse = await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });
      expect(uploadResponse.statusCode).toBe(404);

      const destroyResponse = await harness.app.inject({
        method: 'POST',
        url: `/user_destroy_image.fcgi?session=${token}`,
        payload: { user_id: 999999 },
        headers: jsonHeaders(),
      });
      expect(destroyResponse.statusCode).toBe(404);
    });

    it('user_set_image.fcgi with a missing/non-integer user_id → 400', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);

      const { payload, headers } = multipartFile(jpegBytes(), 'face.jpg', 'image/jpeg', {
        user_id: 'not-a-number',
      });
      const response = await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload,
        headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('re-uploading overwrites the prior photo', async () => {
      harness = await buildTestApp();
      const token = await login(harness.app);
      const userId = await createUser(harness, token);

      const firstUpload = multipartFile(jpegBytes(), 'face.jpg', 'image/jpeg', {
        user_id: String(userId),
      });
      await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload: firstUpload.payload,
        headers: firstUpload.headers,
      });

      const pngBody = pngBytes();
      const secondUpload = multipartFile(pngBody, 'face.png', 'image/png', {
        user_id: String(userId),
      });
      await harness.app.inject({
        method: 'POST',
        url: `/user_set_image.fcgi?session=${token}`,
        payload: secondUpload.payload,
        headers: secondUpload.headers,
      });

      const getResponse = await harness.app.inject({
        method: 'GET',
        url: `/user_get_image.fcgi?user_id=${String(userId)}&session=${token}`,
      });
      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.headers['content-type']).toContain('image/png');
      expect(Buffer.from(getResponse.rawPayload).equals(pngBody)).toBe(true);
    });
  },
);
