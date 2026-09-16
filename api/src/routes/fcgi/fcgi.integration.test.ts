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
