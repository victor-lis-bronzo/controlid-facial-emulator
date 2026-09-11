/**
 * GroupRepository — typed reads/writes for Groups and their membership
 * (Req 4.1, 4.3, 4.4, 4.6, 4.8) plus the referential-integrity lookup used by
 * the service layer to produce the `409` when a referenced Group is deleted
 * (Req 7.7).
 *
 * Validation and the `409`/`404` decisions live in {@link GroupService}; this
 * repository performs only typed DB access over {@link DrizzleDb}. Multi-table
 * writes (membership replacement) run inside a Drizzle transaction so a failure
 * persists nothing.
 *
 * See design.md → "GroupRepository".
 */
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { accessRuleGroups, groups, users, usersGroups } from '../db/schema.js';
import type { AdminUserView } from './user-repository.js';

/** List projection of a Group (Req 4.3): id, name, and member count. */
export interface GroupView {
  id: number;
  name: string;
  memberCount: number;
}

/** Detail projection of a Group (Req 4.4): id, name, and member Users. */
export interface GroupDetail {
  id: number;
  name: string;
  members: AdminUserView[];
}

export class GroupRepository {
  public constructor(private readonly db: DrizzleDb) {}

  /** Return every Group with its member count (Req 4.3). */
  async list(): Promise<GroupView[]> {
    const rows = this.db.select().from(groups).all();
    const memberships = this.db.select().from(usersGroups).all();
    const counts = new Map<number, number>();
    for (const m of memberships) {
      counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1);
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: counts.get(row.id) ?? 0,
    }));
  }

  /** Return a single Group with its member Users, or `null` (Req 4.4, 4.5). */
  async get(id: number): Promise<GroupDetail | null> {
    const row = this.db.select().from(groups).where(eq(groups.id, id)).get();
    if (!row) {
      return null;
    }
    return { id: row.id, name: row.name, members: this.membersOf(id) };
  }

  /** Create a Group with no members (Req 4.1). */
  async create(name: string): Promise<GroupDetail> {
    const inserted = this.db.insert(groups).values({ name }).run();
    const id = Number(inserted.lastInsertRowid);
    return { id, name, members: [] };
  }

  /**
   * Replace a Group's name and membership with the submitted values (Req 4.6).
   * Runs in a transaction so a failure persists nothing.
   */
  async update(id: number, name: string, memberIds: number[]): Promise<GroupDetail> {
    const distinct = [...new Set(memberIds)];
    this.db.transaction((tx) => {
      tx.update(groups).set({ name }).where(eq(groups.id, id)).run();
      tx.delete(usersGroups).where(eq(usersGroups.groupId, id)).run();
      for (const userId of distinct) {
        tx.insert(usersGroups).values({ userId, groupId: id }).run();
      }
    });
    return { id, name, members: this.membersOf(id) };
  }

  /**
   * Delete a Group and its `users_groups` membership rows (Req 4.8). The member
   * rows are removed explicitly within the transaction (the FK also cascades).
   */
  async delete(id: number): Promise<void> {
    this.db.transaction((tx) => {
      tx.delete(usersGroups).where(eq(usersGroups.groupId, id)).run();
      tx.delete(groups).where(eq(groups.id, id)).run();
    });
  }

  /**
   * Return the subset of `ids` that correspond to existing Groups, so services
   * can validate submitted membership/reference sets (Req 4.7, 7.2).
   */
  async existingIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = this.db
      .select({ id: groups.id })
      .from(groups)
      .where(inArray(groups.id, ids))
      .all();
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Return the ids of every Access Rule that references this Group, so the
   * service can raise a `409` naming them before allowing a delete (Req 7.7).
   */
  async referencingAccessRules(id: number): Promise<number[]> {
    return this.db
      .select({ accessRuleId: accessRuleGroups.accessRuleId })
      .from(accessRuleGroups)
      .where(eq(accessRuleGroups.groupId, id))
      .all()
      .map((r) => r.accessRuleId);
  }

  /** Build the {@link AdminUserView} list for a group's members. */
  private membersOf(groupId: number): AdminUserView[] {
    const memberIds = this.db
      .select({ userId: usersGroups.userId })
      .from(usersGroups)
      .where(eq(usersGroups.groupId, groupId))
      .all()
      .map((r) => r.userId);
    if (memberIds.length === 0) {
      return [];
    }
    const rows = this.db
      .select()
      .from(users)
      .where(inArray(users.id, memberIds))
      .all();
    // Each member's own full membership set, for a faithful AdminUserView.
    const allMemberships = this.db
      .select()
      .from(usersGroups)
      .where(inArray(usersGroups.userId, memberIds))
      .all();
    const byUser = new Map<number, number[]>();
    for (const m of allMemberships) {
      const list = byUser.get(m.userId) ?? [];
      list.push(m.groupId);
      byUser.set(m.userId, list);
    }
    return rows.map((row) => ({
      id: row.id,
      registration: row.registration,
      name: row.name,
      hasPhoto: row.imagePath !== null && row.imagePath !== undefined,
      groupIds: byUser.get(row.id) ?? [],
    }));
  }
}
