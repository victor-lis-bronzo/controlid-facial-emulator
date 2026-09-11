/**
 * Property-based test for the Group membership round-trip invariant (Correctness
 * Property 3; design.md → "Correctness Properties → Property 3").
 *
 * For any set of existing Users and any subset chosen as members, setting the
 * Group's membership and then reading the Group back returns exactly that member
 * set (order-insensitive); and deleting the Group leaves every member User
 * intact. Each iteration uses a fresh ephemeral (`:memory:`) database and the
 * real repository/service graph. Universes are small so 100+ iterations stay
 * fast.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDb, type DrizzleDb } from '../db/connection.js';
import { GroupRepository } from '../repositories/group-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { InMemoryPhotoStorage } from '../repositories/photo-storage-memory.js';
import { GroupService } from './group-service.js';

interface Graph {
  db: DrizzleDb;
  users: UserRepository;
  groupRepo: GroupRepository;
  groups: GroupService;
}

function buildGraph(): Graph {
  const db = createDb({ mode: 'ephemeral' });
  const users = new UserRepository(db, new InMemoryPhotoStorage());
  const groupRepo = new GroupRepository(db);
  return { db, users, groupRepo, groups: new GroupService(groupRepo, users) };
}

describe('Group properties', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = buildGraph();
  });

  afterEach(() => {
    graph.db.$client.close();
  });

  // Feature: admin-management-panel, Property 3
  it('Property 3: membership set round-trips exactly; deleting the group leaves member users intact', async () => {
    await fc.assert(
      fc.asyncProperty(
        // N users to create.
        fc.integer({ min: 0, max: 6 }),
        // A per-user boolean mask selecting the membership subset.
        fc.array(fc.boolean(), { minLength: 0, maxLength: 6 }),
        async (n, mask) => {
          const g = buildGraph();
          try {
            const userIds: number[] = [];
            for (let i = 0; i < n; i += 1) {
              userIds.push(
                (await g.users.create({ registration: `R${String(i)}`, name: `N${String(i)}`, groupIds: [] })).id,
              );
            }
            const memberIds = userIds.filter((_, i) => mask[i % Math.max(mask.length, 1)] ?? false);

            const group = await g.groups.create('G');
            await g.groups.update(group.id, 'G', memberIds);

            // Round-trip: the read-back member set equals the submitted set.
            const detail = await g.groups.get(group.id);
            const readBack = new Set(detail.members.map((m) => m.id));
            expect(readBack).toEqual(new Set(memberIds));

            // Deleting the group leaves every member user intact.
            await g.groups.delete(group.id);
            for (const userId of userIds) {
              expect(await g.users.getAdmin(userId)).not.toBeNull();
            }
          } finally {
            g.db.$client.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
