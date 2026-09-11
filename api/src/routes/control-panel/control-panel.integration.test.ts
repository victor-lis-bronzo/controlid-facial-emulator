/**
 * Control Panel + Interception API integration tests (task 13.2).
 *
 * Live-Fastify round-trips via `app.inject()` over a real app backed by an
 * ephemeral DB. Covers:
 *   - GET /api/identities lists seeded users (Req 7.3)
 *   - POST /api/simulate/authorized missing userId → 400 (Req 6.6)
 *   - simulate endpoints return a PushOutcome shape (Req 6.1–6.3)
 *   - GET /api/interception newest-first and empty-state `[]` (Req 8.5, 8.6)
 *
 * Design choice for speed + hermeticity: the `monitor` target is left UNSET, so
 * every simulate returns a `no_target` PushOutcome instantly — a valid
 * PushOutcome that requires no network and no retry sleeps. The tests assert on
 * the PushOutcome SHAPE (and the authorized-without-user 400), not on dispatch
 * success. (Documented per the task's guidance.)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, type TestApp } from '../test-helpers.js';
import type { PushOutcome } from '../../shared/index.js';

let harness: TestApp | undefined;

afterEach(async () => {
  if (harness !== undefined) {
    await harness.close();
    harness = undefined;
  }
});

/** Seed a user directly through the repository so /api/identities has content. */
async function seedUser(h: TestApp, name: string): Promise<number> {
  const { ids } = await h.container.objectStore.create('users', [
    { registration: `reg-${name}`, name },
  ]);
  return ids[0];
}

/** Assert an object has the structural shape of a PushOutcome. */
function expectPushOutcomeShape(value: unknown): asserts value is PushOutcome {
  expect(value).toBeTypeOf('object');
  const outcome = value as Record<string, unknown>;
  expect(typeof outcome.success).toBe('boolean');
  expect('target' in outcome).toBe(true);
  expect(typeof outcome.attempts).toBe('number');
}

describe('GET /api/identities (Req 7.3)', () => {
  it('lists seeded users', async () => {
    harness = await buildTestApp();
    const id = await seedUser(harness, 'Walter White');

    const response = await harness.app.inject({ method: 'GET', url: '/api/identities' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const identities = response.json() as { id: number; name: string }[];
    expect(identities.length).toBe(1);
    expect(identities[0].id).toBe(id);
    expect(identities[0].name).toBe('Walter White');
  });
});

describe('POST /api/simulate/* (Req 6.1–6.3, 6.6)', () => {
  it('authorized without userId → 400 (Req 6.6)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/simulate/authorized',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as Record<string, string>;
    expect(body['error-description']).toBeDefined();
  });

  it('authorized with a valid identity returns a PushOutcome (no_target when unset)', async () => {
    harness = await buildTestApp();
    const id = await seedUser(harness, 'Neal Caffrey');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/simulate/authorized',
      payload: { userId: id },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    const outcome = response.json();
    expectPushOutcomeShape(outcome);
    // No monitor target configured → no_target, no POST (Req 5.5).
    expect(outcome.target).toBeNull();
    expect(outcome.success).toBe(false);
    expect(outcome.failureCategory).toBe('no_target');
    expect(outcome.attempts).toBe(0);
  });

  it('denied returns a PushOutcome (Req 6.2)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/simulate/denied',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    expectPushOutcomeShape(response.json());
  });

  it('keep-alive returns a PushOutcome (Req 6.3)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/simulate/keep-alive',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    expectPushOutcomeShape(response.json());
  });
});

describe('GET /api/interception (Req 8.5, 8.6)', () => {
  it('returns [] when there are no records (empty-state, Req 8.6)', async () => {
    harness = await buildTestApp();
    // A fresh app has recorded nothing until a request arrives; query directly.
    const records = await harness.container.logger.query();
    expect(records).toEqual([]);
  });

  it('returns records newest-first (Req 8.5)', async () => {
    harness = await buildTestApp();
    // Drive a few inbound requests so the interception log has entries.
    await harness.app.inject({ method: 'POST', url: '/session_is_valid.fcgi', payload: { session: 'a' }, headers: { 'content-type': 'application/json' } });
    await harness.app.inject({ method: 'POST', url: '/session_is_valid.fcgi', payload: { session: 'b' }, headers: { 'content-type': 'application/json' } });
    await harness.app.inject({ method: 'POST', url: '/session_is_valid.fcgi', payload: { session: 'c' }, headers: { 'content-type': 'application/json' } });

    const response = await harness.app.inject({ method: 'GET', url: '/api/interception' });
    expect(response.statusCode).toBe(200);
    const records = response.json() as { id: number }[];
    expect(records.length).toBeGreaterThanOrEqual(3);
    // Strictly decreasing ids → newest-first.
    for (let i = 1; i < records.length; i += 1) {
      expect(records[i - 1].id).toBeGreaterThan(records[i].id);
    }
  });

  it('respects the limit query parameter', async () => {
    harness = await buildTestApp();
    await harness.app.inject({ method: 'GET', url: '/api/identities' });
    await harness.app.inject({ method: 'GET', url: '/api/identities' });
    const response = await harness.app.inject({ method: 'GET', url: '/api/interception?limit=1' });
    expect(response.statusCode).toBe(200);
    const records = response.json() as unknown[];
    expect(records.length).toBe(1);
  });
});
