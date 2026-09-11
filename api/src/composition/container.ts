/**
 * Dependency-injection composition root (task 11.1).
 *
 * `buildContainer` instantiates every service/repository the HTTP layer needs
 * from a ready {@link DrizzleDb} and a {@link ResolvedConfig}, wiring them
 * together in dependency order. It is deliberately free of any Fastify/HTTP
 * concern — that lives in `app.ts` — so the object graph can be constructed and
 * unit-tested in isolation.
 *
 * Test seams: {@link BuildContainerOverrides} lets tests inject a non-network
 * `pushHttpPost` and a no-op `pushSleep` into the {@link PushEngine} so
 * integration tests never trigger the real 10 s timeout / 4×5 s retry sleeps.
 * Production callers pass no overrides and get the real undici-backed client.
 *
 * See design.md → "Architecture (composition root)" and the component
 * interfaces for ConfigService, SessionService, InterceptionLogger, PushEngine,
 * ObjectStore/UserRepository, and SimulationService.
 */
import type { DrizzleDb } from '../db/connection.js';
import type { ResolvedConfig } from './bootstrap.js';
import { ConfigService } from '../services/config-service.js';
import { SessionService } from '../services/session-service.js';
import { InterceptionLogger } from '../services/interception-logger.js';
import {
  PushEngine,
  type HttpPostFn,
  type SleepFn,
} from '../services/push-engine.js';
import { SimulationService } from '../services/simulation-service.js';
import { ObjectStore } from '../repositories/object-store.js';
import { UserRepository } from '../repositories/user-repository.js';

/**
 * Optional test seams for {@link buildContainer}. Production callers omit these
 * and receive the real undici-backed HTTP client and real retry timer.
 */
export interface BuildContainerOverrides {
  /** Injected HTTP client for the PushEngine (avoids real network in tests). */
  pushHttpPost?: HttpPostFn;
  /** Injected retry sleep for the PushEngine (no-op in tests). */
  pushSleep?: SleepFn;
  /** Injected clock (epoch ms) shared by SessionService and SimulationService. */
  now?: () => number;
}

/**
 * The fully-wired object graph shared by the HTTP layer. Every route handler is
 * a thin translator over one of these services.
 */
export interface Container {
  readonly config: ConfigService;
  readonly sessions: SessionService;
  readonly logger: InterceptionLogger;
  readonly pushEngine: PushEngine;
  readonly objectStore: ObjectStore;
  readonly users: UserRepository;
  readonly simulation: SimulationService;
}

/**
 * Instantiate the service/repository object graph from a ready database and the
 * resolved startup configuration (Req 8.1, 6.x, 3.x, 2.x, 4.x).
 *
 * The device id and admin credentials come from {@link ResolvedConfig}. The
 * PushEngine is constructed with the injected HTTP client/sleep when supplied,
 * otherwise its production defaults.
 */
export function buildContainer(
  db: DrizzleDb,
  resolved: ResolvedConfig,
  overrides: BuildContainerOverrides = {},
): Container {
  const config = new ConfigService(db);
  const sessions = new SessionService(db, overrides.now);
  const logger = new InterceptionLogger(db);

  const pushEngine = new PushEngine({
    config,
    logger,
    httpPost: overrides.pushHttpPost,
    sleep: overrides.pushSleep,
  });

  const objectStore = new ObjectStore(db);
  const users = new UserRepository(db);

  const simulation = new SimulationService({
    pushEngine,
    users,
    deviceId: resolved.deviceId,
    now: overrides.now,
  });

  return { config, sessions, logger, pushEngine, objectStore, users, simulation };
}
