/**
 * Shared test helpers for the route integration tests.
 *
 * NOTE: This module is imported only by `*.test.ts` files. It builds a real
 * Fastify app over an ephemeral (`:memory:`) DB with a non-network PushEngine
 * client and a no-op retry sleep, so integration tests never trigger the real
 * 10 s timeout or the 4×5 s retry sleeps.
 */
import type { FastifyInstance } from 'fastify';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { buildContainer, type Container } from '../composition/container.js';
import { buildApp } from '../composition/app.js';
import type { ResolvedConfig } from '../composition/bootstrap.js';
import type { HttpPostFn } from '../services/push-engine.js';
import type {
  PhotoMime,
  PhotoStorage,
  StoredPhoto,
} from '../repositories/photo-storage.js';

/** A fixed resolved config for tests (ephemeral, admin/admin). */
export const TEST_RESOLVED: ResolvedConfig = {
  mode: 'ephemeral',
  dbPath: ':memory:',
  // Tests inject an in-memory PhotoStorage, so this dir is never written to.
  dataDir: '.',
  port: 0,
  deviceId: 478435,
  login: 'admin',
  password: 'admin',
  warnings: [],
};

/** A test harness bundling the app, its container, and a cleanup closer. */
export interface TestApp {
  app: FastifyInstance;
  container: Container;
  db: DrizzleDb;
  close(): Promise<void>;
}

/** Options for {@link buildTestApp}. */
export interface BuildTestAppOptions {
  /** Injected push client; defaults to an always-200 no-network client. */
  pushHttpPost?: HttpPostFn;
  /** Env passed to static-asset resolution (defaults to an empty env). */
  env?: Record<string, string | undefined>;
  /**
   * Injected photo storage; defaults to a fresh {@link InMemoryPhotoStorage} so
   * photo-upload tests never touch disk and each app starts with no photos.
   */
  photoStorage?: PhotoStorage;
}

/**
 * An in-memory {@link PhotoStorage} for tests. Keeps bytes + MIME in a `Map`
 * keyed by user id so `save`/`read`/`delete` mirror the disk implementation's
 * observable behavior (overwrite on re-upload, idempotent delete, `null` when
 * absent) without any filesystem I/O.
 */
export class InMemoryPhotoStorage implements PhotoStorage {
  private readonly photos = new Map<number, { bytes: Buffer; mime: PhotoMime }>();

  async save(userId: number, bytes: Buffer, mime: PhotoMime): Promise<StoredPhoto> {
    this.photos.set(userId, { bytes, mime });
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    return { relativePath: `photos/${String(userId)}.${ext}`, mime };
  }

  async read(userId: number): Promise<{ bytes: Buffer; mime: PhotoMime } | null> {
    return this.photos.get(userId) ?? null;
  }

  async delete(userId: number): Promise<void> {
    this.photos.delete(userId);
  }
}

/**
 * Build a ready-to-inject app over an ephemeral DB. The PushEngine uses an
 * injected client (default: instant 200) and a no-op sleep so dispatch never
 * blocks on real timers or network.
 */
export async function buildTestApp(
  options: BuildTestAppOptions = {},
): Promise<TestApp> {
  const db = createDb({ mode: 'ephemeral' });
  const container = buildContainer(db, TEST_RESOLVED, {
    pushHttpPost: options.pushHttpPost ?? (async () => ({ statusCode: 200 })),
    pushSleep: async () => {},
    photoStorage: options.photoStorage ?? new InMemoryPhotoStorage(),
  });
  const app = await buildApp(container, TEST_RESOLVED, { env: options.env ?? {} });

  return {
    app,
    container,
    db,
    async close(): Promise<void> {
      await app.close();
      db.$client.close();
    },
  };
}

/**
 * Perform a login and return the issued session token. Fails the returned
 * promise if login does not succeed.
 */
export async function login(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login.fcgi',
    payload: { login: 'admin', password: 'admin' },
    headers: { 'content-type': 'application/json' },
  });
  const parsed = response.json() as { session?: string };
  if (typeof parsed.session !== 'string') {
    throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  }
  return parsed.session;
}

/**
 * Alias of {@link login} for the admin integration tests: obtain a valid
 * session token (via `POST /login.fcgi`) that authorizes `/api/admin`
 * mutations, which read the token from `?session=<token>` exactly as the
 * `.fcgi` surface does.
 */
export async function loginSession(app: FastifyInstance): Promise<string> {
  return login(app);
}
