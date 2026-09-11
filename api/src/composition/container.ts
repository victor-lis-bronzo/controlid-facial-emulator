/**
 * Dependency-injection composition root (task 11.1; extended for the Admin
 * Management Panel — task 6.2).
 *
 * `buildContainer` instantiates every service/repository the HTTP layer needs
 * from a ready {@link DrizzleDb} and a {@link ResolvedConfig}, wiring them
 * together in dependency order. It is deliberately free of any Fastify/HTTP
 * concern — that lives in `app.ts` — so the object graph can be constructed and
 * unit-tested in isolation.
 *
 * Test seams: {@link BuildContainerOverrides} lets tests inject a non-network
 * `pushHttpPost` and a no-op `pushSleep` into the {@link PushEngine} so
 * integration tests never trigger the real 10 s timeout / 4×5 s retry sleeps,
 * and a `photoStorage` seam so tests inject an in-memory photo store instead of
 * touching disk. Production callers pass no overrides and get the real
 * undici-backed client and a disk-backed {@link PhotoStorage}.
 *
 * See design.md → "Architecture (composition root)", "Container wiring", and the
 * component interfaces for the admin services/repositories.
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
import { GroupRepository } from '../repositories/group-repository.js';
import { PortalRepository } from '../repositories/portal-repository.js';
import { TimeZoneRepository } from '../repositories/time-zone-repository.js';
import { AccessRuleRepository } from '../repositories/access-rule-repository.js';
import { AccessLogRepository } from '../repositories/access-log-repository.js';
import {
  createPhotoStorage,
  type PhotoStorage,
} from '../repositories/photo-storage.js';
import { UserAdminService } from '../services/user-admin-service.js';
import { GroupService } from '../services/group-service.js';
import { PortalService } from '../services/portal-service.js';
import { TimeZoneService } from '../services/time-zone-service.js';
import { AccessRuleService } from '../services/access-rule-service.js';
import { DashboardService } from '../services/dashboard-service.js';

/**
 * Optional test seams for {@link buildContainer}. Production callers omit these
 * and receive the real undici-backed HTTP client, real retry timer, and a
 * disk-backed {@link PhotoStorage}.
 */
export interface BuildContainerOverrides {
  /** Injected HTTP client for the PushEngine (avoids real network in tests). */
  pushHttpPost?: HttpPostFn;
  /** Injected retry sleep for the PushEngine (no-op in tests). */
  pushSleep?: SleepFn;
  /** Injected clock (epoch ms) shared by SessionService and SimulationService. */
  now?: () => number;
  /** Injected photo storage (in-memory in tests) instead of the disk-backed default. */
  photoStorage?: PhotoStorage;
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
  // --- Admin Management Panel additions (task 6.2). ---
  readonly photos: PhotoStorage;
  readonly groups: GroupService;
  readonly portals: PortalService;
  readonly timeZones: TimeZoneService;
  readonly accessRules: AccessRuleService;
  readonly userAdmin: UserAdminService;
  readonly dashboard: DashboardService;
  /** Read-only repository backing the Access Logs view + Dashboard. */
  readonly accessLogs: AccessLogRepository;
}

/**
 * Instantiate the service/repository object graph from a ready database and the
 * resolved startup configuration.
 *
 * The device id and admin credentials come from {@link ResolvedConfig}; the
 * photo storage root comes from `resolved.dataDir`. The PushEngine and photo
 * storage use the injected test seams when supplied, otherwise their production
 * defaults.
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

  // Photo storage: injected in-memory store in tests, else disk-backed under the
  // resolved data dir (Req 3.1, 13.3).
  const photos = overrides.photoStorage ?? createPhotoStorage(resolved.dataDir);

  const objectStore = new ObjectStore(db);
  const users = new UserRepository(db, photos);

  const simulation = new SimulationService({
    pushEngine,
    users,
    deviceId: resolved.deviceId,
    now: overrides.now,
  });

  // Admin repositories over the same DrizzleDb.
  const groupRepository = new GroupRepository(db);
  const portalRepository = new PortalRepository(db);
  const timeZoneRepository = new TimeZoneRepository(db);
  const accessRuleRepository = new AccessRuleRepository(db);
  const accessLogs = new AccessLogRepository(db);

  // Admin services (validation + referential integrity).
  const userAdmin = new UserAdminService(users, groupRepository, photos);
  const groups = new GroupService(groupRepository, users);
  const portals = new PortalService(portalRepository);
  const timeZones = new TimeZoneService(timeZoneRepository);
  const accessRules = new AccessRuleService(
    accessRuleRepository,
    groupRepository,
    timeZoneRepository,
    portalRepository,
  );
  const dashboard = new DashboardService(
    users,
    groupRepository,
    accessRuleRepository,
    portalRepository,
    accessLogs,
  );

  return {
    config,
    sessions,
    logger,
    pushEngine,
    objectStore,
    users,
    simulation,
    photos,
    groups,
    portals,
    timeZones,
    accessRules,
    userAdmin,
    dashboard,
    accessLogs,
  };
}
