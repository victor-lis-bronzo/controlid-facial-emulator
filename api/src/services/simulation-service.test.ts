/**
 * Unit tests for {@link SimulationService}.
 *
 * These tests use a fresh ephemeral SQLite database and the REAL
 * {@link ConfigService}, {@link UserRepository}, and {@link InterceptionLogger},
 * wired to a {@link PushEngine} whose HTTP client is injected so the test is
 * hermetic (no real network) and instant (a no-op retry sleep). The injected
 * client captures the `(url, body)` of each POST and returns `200`, so a
 * configured monitor target causes `dispatch` to actually POST.
 *
 * Coverage:
 *   - simulateAuthorized(existingUserId): POSTs to the `dao` endpoint; the
 *     payload's inserted access-log carries `event "7"` and the selected
 *     `user_id`; an `access_logs` row becomes loadable (Req 4.1, 6.1).
 *   - simulateAuthorized with a missing/invalid identity (undefined, NaN, or a
 *     non-existent id): throws {@link SimulationError}, performs NO POST, and
 *     appends NO access log (Req 6.6).
 *   - simulateDenied(): POSTs to `dao` with `event "6"` (Req 6.2).
 *   - forceKeepAlive(): POSTs to `device_is_alive` with `{ access_logs, device_id, time }`
 *     (Req 6.3).
 *   - push failure (injected client throws): simulateDenied returns a failed
 *     {@link PushOutcome} (`success:false`) rather than throwing (Req 6.5).
 */
import { describe, it, expect, vi } from 'vitest';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { ConfigService } from './config-service.js';
import { InterceptionLogger } from './interception-logger.js';
import { PushEngine, type HttpPostFn, type SleepFn } from './push-engine.js';
import { UserRepository } from '../repositories/user-repository.js';
import { SimulationService, SimulationError } from './simulation-service.js';
import type { DaoNotification, DeviceIsAliveNotification } from '../shared/index.js';

/** A no-op sleep so retry backoff is instant in tests. */
const noopSleep: SleepFn = async () => {
  // intentionally immediate
};

const DEVICE_ID = 478435;

interface Harness {
  db: DrizzleDb;
  config: ConfigService;
  logger: InterceptionLogger;
  userRepo: UserRepository;
  /** Captured (url, body) pairs for every POST the engine attempted. */
  posts: { url: string; body: string }[];
  httpPost: ReturnType<typeof vi.fn<HttpPostFn>>;
  service: SimulationService;
}

/**
 * Build a fresh harness. When `httpPost` is omitted, a capturing client that
 * returns 200 is used; pass a custom client (e.g. one that throws) to exercise
 * failure paths.
 */
function freshHarness(httpPost?: HttpPostFn, now?: () => number): Harness {
  const db = createDb({ mode: 'ephemeral' });
  const config = new ConfigService(db);
  const logger = new InterceptionLogger(db);
  const userRepo = new UserRepository(db);

  const posts: { url: string; body: string }[] = [];
  const client = vi.fn<HttpPostFn>(
    httpPost ??
      (async (url, body) => {
        posts.push({ url, body });
        return { statusCode: 200 };
      }),
  );

  const pushEngine = new PushEngine({
    config,
    logger,
    httpPost: client,
    sleep: noopSleep,
  });

  const service = new SimulationService({
    pushEngine,
    users: userRepo,
    deviceId: DEVICE_ID,
    now,
  });

  return { db, config, logger, userRepo, posts, httpPost: client, service };
}

/** Configure a monitor target so `resolvePushTarget` composes a real URL. */
async function configureMonitor(config: ConfigService): Promise<void> {
  await config.set({
    monitor: {
      hostname: '192.168.0.20',
      port: '8000',
      path: 'api/notifications',
    },
  });
}

/** Seed a user row directly and return its assigned id. */
function seedUser(db: DrizzleDb, name: string): number {
  const row = db
    .insert(users)
    .values({ registration: '0123', name })
    .returning({ id: users.id })
    .get();
  return row.id;
}

describe('SimulationService', () => {
  it('simulateAuthorized dispatches a dao event 7 for the selected identity and appends a loadable access log (Req 4.1, 6.1)', async () => {
    const h = freshHarness();
    try {
      await configureMonitor(h.config);
      const userId = seedUser(h.db, 'Walter White');

      const outcome = await h.service.simulateAuthorized(userId);

      // A POST was made to the composed dao endpoint.
      expect(h.httpPost).toHaveBeenCalledTimes(1);
      expect(h.posts).toHaveLength(1);
      expect(h.posts[0]!.url).toBe(
        'http://192.168.0.20:8000/api/notifications/dao',
      );
      expect(outcome.success).toBe(true);
      expect(outcome.target).toBe(
        'http://192.168.0.20:8000/api/notifications/dao',
      );

      // Payload: inserted access_logs with event "7" and the selected user id.
      const payload = JSON.parse(h.posts[0]!.body) as DaoNotification;
      expect(payload.device_id).toBe(DEVICE_ID);
      expect(payload.object_changes).toHaveLength(1);
      const change = payload.object_changes[0]!;
      expect(change.object).toBe('access_logs');
      expect(change.type).toBe('inserted');
      expect(change.values.event).toBe('7');
      expect(change.values.user_id).toBe(String(userId));
      expect(change.values.device_id).toBe(String(DEVICE_ID));

      // The access log is now persisted / loadable (Req 4.1).
      const accessRows = h.db.$client
        .prepare('SELECT event, user_id FROM access_logs')
        .all() as { event: string; user_id: string }[];
      expect(accessRows).toHaveLength(1);
      expect(accessRows[0]!.event).toBe('7');
      expect(accessRows[0]!.user_id).toBe(String(userId));
    } finally {
      h.db.$client.close();
    }
  });

  it('simulateAuthorized rejects a missing/invalid/unknown identity without dispatching or appending (Req 6.6)', async () => {
    const h = freshHarness();
    try {
      await configureMonitor(h.config);

      // undefined identity
      await expect(
        h.service.simulateAuthorized(undefined as unknown as number),
      ).rejects.toBeInstanceOf(SimulationError);

      // NaN identity
      await expect(h.service.simulateAuthorized(Number.NaN)).rejects.toBeInstanceOf(
        SimulationError,
      );

      // non-existent id (no users seeded)
      await expect(h.service.simulateAuthorized(999)).rejects.toBeInstanceOf(
        SimulationError,
      );

      // No POST and no access-log row for any of the rejected attempts.
      expect(h.httpPost).not.toHaveBeenCalled();
      const count = h.db.$client
        .prepare('SELECT COUNT(*) AS c FROM access_logs')
        .get() as { c: number };
      expect(count.c).toBe(0);
    } finally {
      h.db.$client.close();
    }
  });

  it('simulateDenied dispatches a dao event 6 (Req 6.2)', async () => {
    const h = freshHarness();
    try {
      await configureMonitor(h.config);

      const outcome = await h.service.simulateDenied();

      expect(outcome.success).toBe(true);
      expect(h.posts).toHaveLength(1);
      expect(h.posts[0]!.url).toBe(
        'http://192.168.0.20:8000/api/notifications/dao',
      );

      const payload = JSON.parse(h.posts[0]!.body) as DaoNotification;
      const change = payload.object_changes[0]!;
      expect(change.object).toBe('access_logs');
      expect(change.values.event).toBe('6');
      expect(change.values.user_id).toBe('0');
    } finally {
      h.db.$client.close();
    }
  });

  it('forceKeepAlive dispatches device_is_alive with { access_logs, device_id, time } (Req 6.3)', async () => {
    // Fixed clock → deterministic epoch-second time.
    const fixedNowMs = 1_739_376_235_000;
    const h = freshHarness(undefined, () => fixedNowMs);
    try {
      await configureMonitor(h.config);

      const outcome = await h.service.forceKeepAlive();

      expect(outcome.success).toBe(true);
      expect(h.posts).toHaveLength(1);
      expect(h.posts[0]!.url).toBe(
        'http://192.168.0.20:8000/api/notifications/device_is_alive',
      );

      const payload = JSON.parse(h.posts[0]!.body) as DeviceIsAliveNotification;
      expect(payload).toStrictEqual({
        access_logs: 0,
        device_id: DEVICE_ID,
        time: Math.floor(fixedNowMs / 1000),
      });
    } finally {
      h.db.$client.close();
    }
  });

  it('simulateDenied returns a failed PushOutcome (not throwing) when the push fails after retries (Req 6.5)', async () => {
    const throwingPost: HttpPostFn = async () => {
      throw new Error('connection refused');
    };
    const h = freshHarness(throwingPost);
    try {
      await configureMonitor(h.config);

      const outcome = await h.service.simulateDenied();

      // The failure surfaces via the outcome, not a thrown error (Req 6.5).
      expect(outcome.success).toBe(false);
      expect(outcome.attempts).toBe(4);
      expect(outcome.failureCategory).toBe('unreachable');
      expect(outcome.target).toBe(
        'http://192.168.0.20:8000/api/notifications/dao',
      );

      // The denied access log was still appended before dispatch (Req 4.1).
      const count = h.db.$client
        .prepare('SELECT COUNT(*) AS c FROM access_logs')
        .get() as { c: number };
      expect(count.c).toBe(1);
    } finally {
      h.db.$client.close();
    }
  });
});
