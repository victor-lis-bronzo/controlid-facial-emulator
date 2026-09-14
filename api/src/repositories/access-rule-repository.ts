/**
 * AccessRuleRepository — typed reads/writes for Access Rules and their three
 * association sets toward Groups, Time Zones, and Portals (Req 7.1, 7.4, 7.5,
 * 7.6, 7.8).
 *
 * Non-empty-set and reference-existence validation live in
 * {@link AccessRuleService}; this repository performs only typed DB access over
 * {@link DrizzleDb}. Association writes run inside a Drizzle transaction so a
 * failure persists nothing. Deleting an Access Rule cascades ONLY its own
 * association rows (via the `ON DELETE CASCADE` toward `access_rules`), leaving
 * the referenced Groups/Time Zones/Portals intact (Req 7.8).
 *
 * See design.md → "AccessRuleRepository".
 */
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import {
  accessRuleGroups,
  accessRulePortals,
  accessRuleTimeZones,
  accessRules,
} from '../db/schema.js';

/** Projection of an Access Rule with its association id sets (Req 7.4). */
export interface AccessRuleView {
  id: number;
  name: string;
  groupIds: number[];
  timeZoneIds: number[];
  portalIds: number[];
}

/** The submitted shape of a create/update Access Rule request (Req 7.1, 7.6). */
export interface AccessRuleWrite {
  name: string;
  groupIds: number[];
  timeZoneIds: number[];
  portalIds: number[];
}

/** The transaction handle passed to the {@link DrizzleDb.transaction} callback. */
type AccessRuleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

export class AccessRuleRepository {
  public constructor(private readonly db: DrizzleDb) {}

  /** Return every Access Rule with its association id sets (Req 7.4). */
  async list(): Promise<AccessRuleView[]> {
    const rules = this.db.select().from(accessRules).all();
    const groupRows = this.db.select().from(accessRuleGroups).all();
    const zoneRows = this.db.select().from(accessRuleTimeZones).all();
    const portalRows = this.db.select().from(accessRulePortals).all();

    const groupsByRule = this.groupBy(groupRows, (r) => r.accessRuleId, (r) => r.groupId);
    const zonesByRule = this.groupBy(zoneRows, (r) => r.accessRuleId, (r) => r.timeZoneId);
    const portalsByRule = this.groupBy(portalRows, (r) => r.accessRuleId, (r) => r.portalId);

    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      groupIds: groupsByRule.get(rule.id) ?? [],
      timeZoneIds: zonesByRule.get(rule.id) ?? [],
      portalIds: portalsByRule.get(rule.id) ?? [],
    }));
  }

  /** Return a single Access Rule by id, or `null` (Req 7.5). */
  async get(id: number): Promise<AccessRuleView | null> {
    const rule = this.db.select().from(accessRules).where(eq(accessRules.id, id)).get();
    if (!rule) {
      return null;
    }
    return { id: rule.id, name: rule.name, ...this.associationsOf(id) };
  }

  /** Create an Access Rule and its associations (Req 7.1), transactionally. */
  async create(write: AccessRuleWrite): Promise<AccessRuleView> {
    const id = this.db.transaction((tx) => {
      const inserted = tx.insert(accessRules).values({ name: write.name }).run();
      const ruleId = Number(inserted.lastInsertRowid);
      this.writeAssociations(tx, ruleId, write);
      return ruleId;
    });
    return { id, name: write.name, ...this.associationsOf(id) };
  }

  /**
   * Replace an Access Rule's name and all three association sets (Req 7.6),
   * transactionally.
   */
  async update(id: number, write: AccessRuleWrite): Promise<AccessRuleView> {
    this.db.transaction((tx) => {
      tx.update(accessRules).set({ name: write.name }).where(eq(accessRules.id, id)).run();
      tx.delete(accessRuleGroups).where(eq(accessRuleGroups.accessRuleId, id)).run();
      tx.delete(accessRuleTimeZones).where(eq(accessRuleTimeZones.accessRuleId, id)).run();
      tx.delete(accessRulePortals).where(eq(accessRulePortals.accessRuleId, id)).run();
      this.writeAssociations(tx, id, write);
    });
    return { id, name: write.name, ...this.associationsOf(id) };
  }

  /**
   * Delete an Access Rule and its own association rows only (Req 7.8). Referenced
   * Groups/Time Zones/Portals are left unchanged. The association rows are
   * removed explicitly within the transaction (the FK toward `access_rules` also
   * cascades).
   */
  async delete(id: number): Promise<void> {
    this.db.transaction((tx) => {
      tx.delete(accessRuleGroups).where(eq(accessRuleGroups.accessRuleId, id)).run();
      tx.delete(accessRuleTimeZones).where(eq(accessRuleTimeZones.accessRuleId, id)).run();
      tx.delete(accessRulePortals).where(eq(accessRulePortals.accessRuleId, id)).run();
      tx.delete(accessRules).where(eq(accessRules.id, id)).run();
    });
  }

  /** Load an Access Rule's three association id sets. */
  private associationsOf(id: number): {
    groupIds: number[];
    timeZoneIds: number[];
    portalIds: number[];
  } {
    const groupIds = this.db
      .select({ groupId: accessRuleGroups.groupId })
      .from(accessRuleGroups)
      .where(eq(accessRuleGroups.accessRuleId, id))
      .all()
      .map((r) => r.groupId);
    const timeZoneIds = this.db
      .select({ timeZoneId: accessRuleTimeZones.timeZoneId })
      .from(accessRuleTimeZones)
      .where(eq(accessRuleTimeZones.accessRuleId, id))
      .all()
      .map((r) => r.timeZoneId);
    const portalIds = this.db
      .select({ portalId: accessRulePortals.portalId })
      .from(accessRulePortals)
      .where(eq(accessRulePortals.accessRuleId, id))
      .all()
      .map((r) => r.portalId);
    return { groupIds, timeZoneIds, portalIds };
  }

  /** Insert the distinct association rows for a rule within a transaction. */
  private writeAssociations(
    tx: AccessRuleTx,
    ruleId: number,
    write: AccessRuleWrite,
  ): void {
    for (const groupId of new Set(write.groupIds)) {
      tx.insert(accessRuleGroups).values({ accessRuleId: ruleId, groupId }).run();
    }
    for (const timeZoneId of new Set(write.timeZoneIds)) {
      tx.insert(accessRuleTimeZones).values({ accessRuleId: ruleId, timeZoneId }).run();
    }
    for (const portalId of new Set(write.portalIds)) {
      tx.insert(accessRulePortals).values({ accessRuleId: ruleId, portalId }).run();
    }
  }

  /** Group rows by a key, collecting a mapped value into arrays. */
  private groupBy<T>(
    rows: T[],
    keyOf: (row: T) => number,
    valueOf: (row: T) => number,
  ): Map<number, number[]> {
    const map = new Map<number, number[]>();
    for (const row of rows) {
      const key = keyOf(row);
      const list = map.get(key) ?? [];
      list.push(valueOf(row));
      map.set(key, list);
    }
    return map;
  }
}
