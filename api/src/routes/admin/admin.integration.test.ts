/**
 * Admin API integration tests (task 9.3).
 *
 * Live-Fastify round-trips via `app.inject()` over a real app backed by an
 * ephemeral DB and an in-memory {@link InMemoryPhotoStorage} (no disk, no
 * network, no push retries). Exercises, per entity, CRUD success plus the
 * `400`/`401`/`404` and (Groups/Portals/Time Zones) `409` error paths from the
 * design's "Admin API Endpoint Specification" and "Error Handling"; the photo
 * upload → `user_get_image.fcgi` round-trip with bad-mime `400` and >5 MB `413`;
 * the access-log filters (single/combined/empty/invalid); and the dashboard
 * counts + recent-logs shape (Req 2–10, 14.2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  jpegBytes,
  loginSession,
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

/** Build a fresh app + a logged-in session token. */
async function setup(): Promise<{ h: TestApp; session: string }> {
  harness = await buildTestApp();
  const session = await loginSession(harness.app);
  return { h: harness, session };
}

/** Read the `error-description` from a JSON error body. */
function errorDescription(response: { json(): unknown }): string {
  const body = response.json() as Record<string, unknown>;
  return String(body['error-description'] ?? '');
}

// ---------------------------------------------------------------------------
// Users (Req 2, 3)
// ---------------------------------------------------------------------------

describe('Admin Users CRUD (Req 2)', () => {
  it('creates (201), reads, updates (200), lists, and deletes (200)', async () => {
    const { h, session } = await setup();

    const created = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users?session=${session}`,
      payload: { registration: 'reg-1', name: 'Alice', pin: '1234' },
      headers: { 'content-type': 'application/json' },
    });
    expect(created.statusCode).toBe(201);
    const user = created.json() as { id: number; registration: string; hasPhoto: boolean };
    expect(user.registration).toBe('reg-1');
    expect(user.hasPhoto).toBe(false);

    const read = await h.app.inject({ method: 'GET', url: `/api/admin/users/${user.id}` });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { name: string }).name).toBe('Alice');

    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/admin/users/${user.id}?session=${session}`,
      payload: { registration: 'reg-1', name: 'Alice B', groupIds: [] },
      headers: { 'content-type': 'application/json' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { name: string }).name).toBe('Alice B');

    const list = await h.app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as unknown[]).length).toBe(1);

    const deleted = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${user.id}?session=${session}`,
    });
    expect(deleted.statusCode).toBe(200);
    expect((deleted.json() as { deleted: boolean }).deleted).toBe(true);
  });

  it('rejects a missing name with 400 naming the field', async () => {
    const { h, session } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users?session=${session}`,
      payload: { registration: 'reg-1' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorDescription(response)).toContain('name');
  });

  it('rejects a mutation without a session with 401', async () => {
    const { h } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { registration: 'reg-1', name: 'Alice' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown user id', async () => {
    const { h } = await setup();
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/users/9999' });
    expect(response.statusCode).toBe(404);
  });

  it('returns 400 for a non-integer id', async () => {
    const { h } = await setup();
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/users/abc' });
    expect(response.statusCode).toBe(400);
    expect(errorDescription(response)).toContain('id');
  });
});

// ---------------------------------------------------------------------------
// User photo (Req 3)
// ---------------------------------------------------------------------------

describe('Admin User photo (Req 3)', () => {
  async function createUser(h: TestApp, session: string): Promise<number> {
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users?session=${session}`,
      payload: { registration: 'reg-photo', name: 'Photo User' },
      headers: { 'content-type': 'application/json' },
    });
    return (created.json() as { id: number }).id;
  }

  it('uploads a JPEG (200) then serves the bytes via user_get_image.fcgi round-trip', async () => {
    const { h, session } = await setup();
    const id = await createUser(h, session);
    const bytes = jpegBytes(32);
    const { payload, headers } = multipartFile(bytes, 'face.jpg', 'image/jpeg');

    const upload = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/photo?session=${session}`,
      payload,
      headers,
    });
    expect(upload.statusCode).toBe(200);
    expect((upload.json() as { hasPhoto: boolean }).hasPhoto).toBe(true);

    // The user now reports hasPhoto=true.
    const read = await h.app.inject({ method: 'GET', url: `/api/admin/users/${id}` });
    expect((read.json() as { hasPhoto: boolean }).hasPhoto).toBe(true);

    // Round-trip through the existing image endpoint with the stored mime.
    const image = await h.app.inject({
      method: 'GET',
      url: `/user_get_image.fcgi?user_id=${id}&session=${session}`,
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(image.rawPayload).equals(bytes)).toBe(true);
  });

  it('serves a PNG with the correct content type after upload', async () => {
    const { h, session } = await setup();
    const id = await createUser(h, session);
    const bytes = pngBytes(24);
    const { payload, headers } = multipartFile(bytes, 'face.png', 'image/png');

    const upload = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/photo?session=${session}`,
      payload,
      headers,
    });
    expect(upload.statusCode).toBe(200);

    const image = await h.app.inject({
      method: 'GET',
      url: `/user_get_image.fcgi?user_id=${id}&session=${session}`,
    });
    expect(image.headers['content-type']).toContain('image/png');
    expect(Buffer.from(image.rawPayload).equals(bytes)).toBe(true);
  });

  it('deletes a stored photo (200) and reflects hasPhoto=false', async () => {
    const { h, session } = await setup();
    const id = await createUser(h, session);
    const { payload, headers } = multipartFile(jpegBytes(), 'face.jpg', 'image/jpeg');
    await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/photo?session=${session}`,
      payload,
      headers,
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${id}/photo?session=${session}`,
    });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { hasPhoto: boolean }).hasPhoto).toBe(false);

    const image = await h.app.inject({
      method: 'GET',
      url: `/user_get_image.fcgi?user_id=${id}&session=${session}`,
    });
    expect(image.statusCode).toBe(404);
  });

  it('rejects an unaccepted mime with 400 and stores nothing', async () => {
    const { h, session } = await setup();
    const id = await createUser(h, session);
    // Declared as GIF; the handler rejects on the declared mime.
    const { payload, headers } = multipartFile(jpegBytes(), 'face.gif', 'image/gif');

    const upload = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/photo?session=${session}`,
      payload,
      headers,
    });
    expect(upload.statusCode).toBe(400);
    expect(errorDescription(upload)).toContain('JPEG, PNG');

    // No photo stored.
    const read = await h.app.inject({ method: 'GET', url: `/api/admin/users/${id}` });
    expect((read.json() as { hasPhoto: boolean }).hasPhoto).toBe(false);
  });

  it('rejects a JPEG-declared file with wrong magic bytes with 400 (magic-byte sniff)', async () => {
    const { h, session } = await setup();
    const id = await createUser(h, session);
    // Declared JPEG but bytes are not a real JPEG/PNG.
    const bogus = Buffer.from('not an image at all', 'utf8');
    const { payload, headers } = multipartFile(bogus, 'face.jpg', 'image/jpeg');

    const upload = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/photo?session=${session}`,
      payload,
      headers,
    });
    expect(upload.statusCode).toBe(400);
    expect(errorDescription(upload)).toContain('JPEG, PNG');
  });

  it('rejects a photo larger than 5 MB with 413', async () => {
    const { h, session } = await setup();
    const id = await createUser(h, session);
    const tooLarge = jpegBytes(5 * 1024 * 1024 + 1024);
    const { payload, headers } = multipartFile(tooLarge, 'big.jpg', 'image/jpeg');

    const upload = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/photo?session=${session}`,
      payload,
      headers,
    });
    expect(upload.statusCode).toBe(413);
    expect(errorDescription(upload)).toContain('5 MB');
  });

  it('rejects a photo upload without a session with 401', async () => {
    const { h, session } = await setup();
    const id = await createUser(h, session);
    const { payload, headers } = multipartFile(jpegBytes(), 'face.jpg', 'image/jpeg');
    const upload = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/photo`,
      payload,
      headers,
    });
    expect(upload.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Groups (Req 4, 7.7)
// ---------------------------------------------------------------------------

describe('Admin Groups CRUD (Req 4, 7.7)', () => {
  it('creates (201), updates with members (200), lists, and deletes (200)', async () => {
    const { h, session } = await setup();

    const userResp = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users?session=${session}`,
      payload: { registration: 'r', name: 'Member' },
      headers: { 'content-type': 'application/json' },
    });
    const userId = (userResp.json() as { id: number }).id;

    const created = await h.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${session}`,
      payload: { name: 'Staff' },
      headers: { 'content-type': 'application/json' },
    });
    expect(created.statusCode).toBe(201);
    const groupId = (created.json() as { id: number }).id;

    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/admin/groups/${groupId}?session=${session}`,
      payload: { name: 'Staff', memberIds: [userId] },
      headers: { 'content-type': 'application/json' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { members: unknown[] }).members.length).toBe(1);

    const list = await h.app.inject({ method: 'GET', url: '/api/admin/groups' });
    expect((list.json() as { memberCount: number }[])[0].memberCount).toBe(1);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/groups/${groupId}?session=${session}`,
    });
    expect(del.statusCode).toBe(200);
  });

  it('rejects an empty name with 400', async () => {
    const { h, session } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${session}`,
      payload: { name: '' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorDescription(response)).toContain('name');
  });

  it('rejects a create without a session with 401', async () => {
    const { h } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/admin/groups',
      payload: { name: 'Staff' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown group id', async () => {
    const { h } = await setup();
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/groups/9999' });
    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when a member id does not exist', async () => {
    const { h, session } = await setup();
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/admin/groups?session=${session}`,
      payload: { name: 'Staff' },
      headers: { 'content-type': 'application/json' },
    });
    const groupId = (created.json() as { id: number }).id;
    const response = await h.app.inject({
      method: 'PUT',
      url: `/api/admin/groups/${groupId}?session=${session}`,
      payload: { name: 'Staff', memberIds: [4242] },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 409 when deleting a group referenced by an access rule', async () => {
    const { h, session } = await setup();
    const groupId = await createReferencedRule(h, session).then((r) => r.groupId);
    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/groups/${groupId}?session=${session}`,
    });
    expect(response.statusCode).toBe(409);
    expect(errorDescription(response)).toMatch(/Access Rule/i);
  });
});

// ---------------------------------------------------------------------------
// Portals (Req 6, 7.7)
// ---------------------------------------------------------------------------

describe('Admin Portals CRUD (Req 6, 7.7)', () => {
  it('creates (201), updates (200), and deletes (200)', async () => {
    const { h, session } = await setup();
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/admin/portals?session=${session}`,
      payload: { name: 'Front Door' },
      headers: { 'content-type': 'application/json' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: number }).id;

    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/admin/portals/${id}?session=${session}`,
      payload: { name: 'Rear Door' },
      headers: { 'content-type': 'application/json' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { name: string }).name).toBe('Rear Door');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/portals/${id}?session=${session}`,
    });
    expect(del.statusCode).toBe(200);
  });

  it('rejects an empty name with 400', async () => {
    const { h, session } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/admin/portals?session=${session}`,
      payload: { name: '' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a create without a session with 401', async () => {
    const { h } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/admin/portals',
      payload: { name: 'Door' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown portal id', async () => {
    const { h } = await setup();
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/portals/9999' });
    expect(response.statusCode).toBe(404);
  });

  it('returns 409 when deleting a portal referenced by an access rule', async () => {
    const { h, session } = await setup();
    const portalId = await createReferencedRule(h, session).then((r) => r.portalId);
    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/portals/${portalId}?session=${session}`,
    });
    expect(response.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Time Zones (Req 5, 7.7)
// ---------------------------------------------------------------------------

describe('Admin Time Zones CRUD (Req 5, 7.7)', () => {
  it('creates (201) with a valid range, updates (200), and deletes (200)', async () => {
    const { h, session } = await setup();
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/admin/time-zones?session=${session}`,
      payload: {
        name: 'Business Hours',
        timeRanges: [{ days: ['mon', 'tue'], startTime: '09:00', endTime: '17:00' }],
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: number; timeRanges: unknown[] }).id;
    expect((created.json() as { timeRanges: unknown[] }).timeRanges.length).toBe(1);

    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/admin/time-zones/${id}?session=${session}`,
      payload: {
        name: 'Business Hours',
        timeRanges: [{ days: ['wed'], startTime: '08:00', endTime: '12:00' }],
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(updated.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/time-zones/${id}?session=${session}`,
    });
    expect(del.statusCode).toBe(200);
  });

  it('rejects a range where start is not before end with 400', async () => {
    const { h, session } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/admin/time-zones?session=${session}`,
      payload: {
        name: 'Bad',
        timeRanges: [{ days: ['mon'], startTime: '17:00', endTime: '09:00' }],
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a create without a session with 401', async () => {
    const { h } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/admin/time-zones',
      payload: { name: 'TZ', timeRanges: [] },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown time-zone id', async () => {
    const { h } = await setup();
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/time-zones/9999' });
    expect(response.statusCode).toBe(404);
  });

  it('returns 409 when deleting a time zone referenced by an access rule', async () => {
    const { h, session } = await setup();
    const timeZoneId = await createReferencedRule(h, session).then((r) => r.timeZoneId);
    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/time-zones/${timeZoneId}?session=${session}`,
    });
    expect(response.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Access Rules (Req 7)
// ---------------------------------------------------------------------------

describe('Admin Access Rules CRUD (Req 7)', () => {
  it('creates (201), updates (200), and deletes (200) leaving references intact', async () => {
    const { h, session } = await setup();
    const { groupId, timeZoneId, portalId, ruleId } = await createReferencedRule(h, session);
    expect(ruleId).toBeGreaterThan(0);

    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/admin/access-rules/${ruleId}?session=${session}`,
      payload: {
        name: 'Rule B',
        groupIds: [groupId],
        timeZoneIds: [timeZoneId],
        portalIds: [portalId],
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { name: string }).name).toBe('Rule B');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/access-rules/${ruleId}?session=${session}`,
    });
    expect(del.statusCode).toBe(200);

    // The referenced entities are untouched (deletable now).
    const portalDel = await h.app.inject({
      method: 'DELETE',
      url: `/api/admin/portals/${portalId}?session=${session}`,
    });
    expect(portalDel.statusCode).toBe(200);
  });

  it('rejects an empty group set with 400', async () => {
    const { h, session } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/admin/access-rules?session=${session}`,
      payload: { name: 'Rule', groupIds: [], timeZoneIds: [1], portalIds: [1] },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorDescription(response)).toContain('groupIds');
  });

  it('rejects an unknown reference with 400', async () => {
    const { h, session } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/admin/access-rules?session=${session}`,
      payload: { name: 'Rule', groupIds: [999], timeZoneIds: [999], portalIds: [999] },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a create without a session with 401', async () => {
    const { h } = await setup();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/admin/access-rules',
      payload: { name: 'Rule', groupIds: [1], timeZoneIds: [1], portalIds: [1] },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown access-rule id', async () => {
    const { h } = await setup();
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/access-rules/9999' });
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Access Logs (Req 8)
// ---------------------------------------------------------------------------

describe('Admin Access Logs (Req 8)', () => {
  /** Seed access_logs directly through the users repository. */
  async function seedLogs(h: TestApp): Promise<void> {
    await h.container.users.appendAccessLog({
      time: '1000',
      event: '7',
      device_id: 'dev',
      user_id: '11',
    });
    await h.container.users.appendAccessLog({
      time: '2000',
      event: '6',
      device_id: 'dev',
      user_id: '22',
    });
    await h.container.users.appendAccessLog({
      time: '3000',
      event: '7',
      device_id: 'dev',
      user_id: '11',
    });
  }

  it('returns all logs newest-first', async () => {
    const { h } = await setup();
    await seedLogs(h);
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/access-logs' });
    expect(response.statusCode).toBe(200);
    const rows = response.json() as { time: string }[];
    expect(rows.map((r) => r.time)).toEqual(['3000', '2000', '1000']);
  });

  it('filters by a single parameter (user_id)', async () => {
    const { h } = await setup();
    await seedLogs(h);
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/admin/access-logs?user_id=11',
    });
    const rows = response.json() as { user_id: string }[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.user_id === '11')).toBe(true);
  });

  it('filters by combined parameters (user_id + event + time range)', async () => {
    const { h } = await setup();
    await seedLogs(h);
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/admin/access-logs?user_id=11&event=7&from=2500&to=3500',
    });
    const rows = response.json() as { time: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].time).toBe('3000');
  });

  it('returns an empty collection with 200 when nothing matches', async () => {
    const { h } = await setup();
    await seedLogs(h);
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/admin/access-logs?user_id=99',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns 400 naming the parameter on an invalid filter value', async () => {
    const { h } = await setup();
    await seedLogs(h);
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/admin/access-logs?from=not-a-date',
    });
    expect(response.statusCode).toBe(400);
    expect(errorDescription(response)).toContain('from');
  });

  it('accepts an ISO date for the time filter', async () => {
    const { h } = await setup();
    await h.container.users.appendAccessLog({
      time: String(Math.floor(Date.parse('2020-06-15T12:00:00Z') / 1000)),
      event: '7',
      device_id: 'dev',
      user_id: '5',
    });
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/admin/access-logs?from=2020-01-01&to=2020-12-31',
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as unknown[]).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Dashboard (Req 9)
// ---------------------------------------------------------------------------

describe('Admin Dashboard (Req 9)', () => {
  it('returns zero counts and an empty recent-logs list when empty', async () => {
    const { h } = await setup();
    const response = await h.app.inject({ method: 'GET', url: '/api/admin/dashboard' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      counts: { users: number; groups: number; accessRules: number; portals: number };
      recentLogs: unknown[];
    };
    expect(body.counts).toEqual({ users: 0, groups: 0, accessRules: 0, portals: 0 });
    expect(body.recentLogs).toEqual([]);
  });

  it('returns aggregate counts and recent logs shape', async () => {
    const { h, session } = await setup();
    await createReferencedRule(h, session); // 1 group, 1 tz, 1 portal, 1 rule
    await h.app.inject({
      method: 'POST',
      url: `/api/admin/users?session=${session}`,
      payload: { registration: 'reg-dash', name: 'Dash User' },
      headers: { 'content-type': 'application/json' },
    });
    await h.container.users.appendAccessLog({ event: '7', device_id: 'dev', user_id: '1' });

    const response = await h.app.inject({ method: 'GET', url: '/api/admin/dashboard' });
    const body = response.json() as {
      counts: { users: number; groups: number; accessRules: number; portals: number };
      recentLogs: unknown[];
    };
    expect(body.counts.groups).toBe(1);
    expect(body.counts.portals).toBe(1);
    expect(body.counts.accessRules).toBe(1);
    expect(body.counts.users).toBe(1);
    expect(body.recentLogs.length).toBe(1);
  });
});

/**
 * Create a Group, Time Zone, Portal, and an Access Rule referencing all three,
 * returning their ids. Used by the referential-integrity (409) and access-rule
 * tests.
 */
async function createReferencedRule(
  h: TestApp,
  session: string,
): Promise<{ groupId: number; timeZoneId: number; portalId: number; ruleId: number }> {
  const group = await h.app.inject({
    method: 'POST',
    url: `/api/admin/groups?session=${session}`,
    payload: { name: 'G' },
    headers: { 'content-type': 'application/json' },
  });
  const groupId = (group.json() as { id: number }).id;

  const tz = await h.app.inject({
    method: 'POST',
    url: `/api/admin/time-zones?session=${session}`,
    payload: {
      name: 'TZ',
      timeRanges: [{ days: ['mon'], startTime: '09:00', endTime: '17:00' }],
    },
    headers: { 'content-type': 'application/json' },
  });
  const timeZoneId = (tz.json() as { id: number }).id;

  const portal = await h.app.inject({
    method: 'POST',
    url: `/api/admin/portals?session=${session}`,
    payload: { name: 'P' },
    headers: { 'content-type': 'application/json' },
  });
  const portalId = (portal.json() as { id: number }).id;

  const rule = await h.app.inject({
    method: 'POST',
    url: `/api/admin/access-rules?session=${session}`,
    payload: {
      name: 'Rule A',
      groupIds: [groupId],
      timeZoneIds: [timeZoneId],
      portalIds: [portalId],
    },
    headers: { 'content-type': 'application/json' },
  });
  const ruleId = (rule.json() as { id: number }).id;

  return { groupId, timeZoneId, portalId, ruleId };
}
