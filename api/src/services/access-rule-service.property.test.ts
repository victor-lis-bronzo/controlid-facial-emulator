/**
 * Property-based tests for the Access Rule invariants (Correctness Properties 2
 * and 4; design.md → "Correctness Properties").
 *
 * Each iteration builds a fresh ephemeral (`:memory:`) database and the full
 * repository/service graph, so the properties exercise real Drizzle/SQLite
 * transactions and the service-layer validation + referential-integrity checks.
 * Universes are kept small so 100+ iterations stay fast.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { GroupRepository } from '../repositories/group-repository.js';
import { PortalRepository } from '../repositories/portal-repository.js';
import { TimeZoneRepository } from '../repositories/time-zone-repository.js';
import { AccessRuleRepository } from '../repositories/access-rule-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { InMemoryPhotoStorage } from '../repositories/photo-storage-memory.js';
import { GroupService } from './group-service.js';
import { PortalService } from './portal-service.js';
import { TimeZoneService } from './time-zone-service.js';
import { AccessRuleService } from './access-rule-service.js';
import { ConflictError, BadRequestError } from '../routes/errors.js';

interface Graph {
  db: DrizzleDb;
  groupRepo: GroupRepository;
  timeZoneRepo: TimeZoneRepository;
  portalRepo: PortalRepository;
  accessRuleRepo: AccessRuleRepository;
  groups: GroupService;
  timeZones: TimeZoneService;
  portals: PortalService;
  accessRules: AccessRuleService;
}

function buildGraph(): Graph {
  const db = createDb({ mode: 'ephemeral' });
  const users = new UserRepository(db, new InMemoryPhotoStorage());
  const groupRepo = new GroupRepository(db);
  const timeZoneRepo = new TimeZoneRepository(db);
  const portalRepo = new PortalRepository(db);
  const accessRuleRepo = new AccessRuleRepository(db);
  return {
    db,
    groupRepo,
    timeZoneRepo,
    portalRepo,
    accessRuleRepo,
    groups: new GroupService(groupRepo, users),
    timeZones: new TimeZoneService(timeZoneRepo),
    portals: new PortalService(portalRepo),
    accessRules: new AccessRuleService(accessRuleRepo, groupRepo, timeZoneRepo, portalRepo),
  };
}

/** Pick a non-empty subset of `ids` chosen by a boolean mask (at least one). */
function nonEmptySubset(ids: number[], picks: boolean[]): number[] {
  const chosen = ids.filter((_, i) => picks[i % picks.length]);
  return chosen.length > 0 ? chosen : [ids[0]];
}

describe('Access Rule properties', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = buildGraph();
  });

  afterEach(() => {
    graph.db.$client.close();
  });

  // Feature: admin-management-panel, Property 2
  it('Property 2: deleting a referenced entity is a 409 and it survives; unreferenced deletes succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
        async (nGroups, nZones, nPortals, picks) => {
          const g = buildGraph();
          try {
            const groupIds: number[] = [];
            for (let i = 0; i < nGroups; i += 1) {
              groupIds.push((await g.groups.create(`G${String(i)}`)).id);
            }
            const zoneIds: number[] = [];
            for (let i = 0; i < nZones; i += 1) {
              zoneIds.push((await g.timeZones.create(`Z${String(i)}`, [])).id);
            }
            const portalIds: number[] = [];
            for (let i = 0; i < nPortals; i += 1) {
              portalIds.push((await g.portals.create(`P${String(i)}`)).id);
            }

            const refGroups = nonEmptySubset(groupIds, picks);
            const refZones = nonEmptySubset(zoneIds, picks);
            const refPortals = nonEmptySubset(portalIds, picks);

            await g.accessRules.create({
              name: 'AR',
              groupIds: refGroups,
              timeZoneIds: refZones,
              portalIds: refPortals,
            });

            // Referenced entities cannot be deleted (409) and must still exist.
            const refGroup = refGroups[0];
            await expect(g.groups.delete(refGroup)).rejects.toBeInstanceOf(ConflictError);
            expect(await g.groupRepo.get(refGroup)).not.toBeNull();

            const refZone = refZones[0];
            await expect(g.timeZones.delete(refZone)).rejects.toBeInstanceOf(ConflictError);
            expect(await g.timeZoneRepo.get(refZone)).not.toBeNull();

            const refPortal = refPortals[0];
            await expect(g.portals.delete(refPortal)).rejects.toBeInstanceOf(ConflictError);
            expect(await g.portalRepo.get(refPortal)).not.toBeNull();

            // An unreferenced entity of each type (if any) deletes successfully.
            const freeGroup = groupIds.find((id) => !refGroups.includes(id));
            if (freeGroup !== undefined) {
              await g.groups.delete(freeGroup);
              expect(await g.groupRepo.get(freeGroup)).toBeNull();
            }
            const freeZone = zoneIds.find((id) => !refZones.includes(id));
            if (freeZone !== undefined) {
              await g.timeZones.delete(freeZone);
              expect(await g.timeZoneRepo.get(freeZone)).toBeNull();
            }
            const freePortal = portalIds.find((id) => !refPortals.includes(id));
            if (freePortal !== undefined) {
              await g.portals.delete(freePortal);
              expect(await g.portalRepo.get(freePortal)).toBeNull();
            }
          } finally {
            g.db.$client.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: admin-management-panel, Property 4
  it('Property 4: an Access Rule is created iff name valid, each set non-empty, and every reference exists; else 400 and nothing persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A universe of entities to reference (always at least one of each).
        fc.integer({ min: 1, max: 3 }),
        // Name: valid (1..128) or invalid (empty or > 128).
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 128 }),
          fc.constant(''),
          fc.string({ minLength: 129, maxLength: 140 }),
        ),
        // Whether each association set is empty (invalid) or references entities.
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        // Whether to inject a dangling (non-existent) id into the group set.
        fc.boolean(),
        async (universe, name, gEmpty, zEmpty, pEmpty, dangling) => {
          const g = buildGraph();
          try {
            const groupIds: number[] = [];
            const zoneIds: number[] = [];
            const portalIds: number[] = [];
            for (let i = 0; i < universe; i += 1) {
              groupIds.push((await g.groups.create(`G${String(i)}`)).id);
              zoneIds.push((await g.timeZones.create(`Z${String(i)}`, [])).id);
              portalIds.push((await g.portals.create(`P${String(i)}`)).id);
            }

            const submittedGroups = gEmpty
              ? []
              : dangling
                ? [...groupIds, 999_999]
                : [...groupIds];
            const submittedZones = zEmpty ? [] : [...zoneIds];
            const submittedPortals = pEmpty ? [] : [...portalIds];

            const nameValid = name.length >= 1 && name.length <= 128;
            const setsNonEmpty = !gEmpty && !zEmpty && !pEmpty;
            const refsExist = !dangling; // only the group set may carry a dangling id
            const shouldSucceed = nameValid && setsNonEmpty && refsExist;

            const before = (await g.accessRules.list()).length;

            let succeeded = false;
            try {
              await g.accessRules.create({
                name,
                groupIds: submittedGroups,
                timeZoneIds: submittedZones,
                portalIds: submittedPortals,
              });
              succeeded = true;
            } catch (error) {
              expect(error).toBeInstanceOf(BadRequestError);
            }

            expect(succeeded).toBe(shouldSucceed);

            const after = (await g.accessRules.list()).length;
            expect(after).toBe(shouldSucceed ? before + 1 : before);
          } finally {
            g.db.$client.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
