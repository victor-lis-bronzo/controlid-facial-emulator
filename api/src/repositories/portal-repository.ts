/**
 * PortalRepository — typed reads/writes for Portals (doors) (Req 6.1, 6.3, 6.5,
 * 6.6) plus the referential-integrity lookup used by the service layer to
 * produce the `409` when a referenced Portal is deleted (Req 7.7).
 *
 * Validation and the `409`/`404` decisions live in {@link PortalService}; this
 * repository performs only typed DB access over {@link DrizzleDb}.
 *
 * See design.md → "PortalRepository".
 */
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { accessRulePortals, portals } from '../db/schema.js';

/** Projection of a Portal (Req 6.3): id and name. */
export interface PortalView {
  id: number;
  name: string;
}

export class PortalRepository {
  public constructor(private readonly db: DrizzleDb) {}

  /** Return every Portal (Req 6.3). */
  async list(): Promise<PortalView[]> {
    return this.db.select().from(portals).all().map((row) => ({ id: row.id, name: row.name }));
  }

  /** Return a single Portal by id, or `null` (Req 6.4). */
  async get(id: number): Promise<PortalView | null> {
    const row = this.db.select().from(portals).where(eq(portals.id, id)).get();
    return row ? { id: row.id, name: row.name } : null;
  }

  /** Create a Portal (Req 6.1). */
  async create(name: string): Promise<PortalView> {
    const inserted = this.db.insert(portals).values({ name }).run();
    return { id: Number(inserted.lastInsertRowid), name };
  }

  /** Replace a Portal's name (Req 6.5). */
  async update(id: number, name: string): Promise<PortalView> {
    this.db.update(portals).set({ name }).where(eq(portals.id, id)).run();
    return { id, name };
  }

  /** Delete a Portal (Req 6.6). */
  async delete(id: number): Promise<void> {
    this.db.delete(portals).where(eq(portals.id, id)).run();
  }

  /**
   * Return the subset of `ids` that correspond to existing Portals, so the
   * Access Rule service can validate referenced ids (Req 7.2).
   */
  async existingIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = this.db
      .select({ id: portals.id })
      .from(portals)
      .where(inArray(portals.id, ids))
      .all();
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Return the ids of every Access Rule that references this Portal, so the
   * service can raise a `409` naming them before allowing a delete (Req 7.7).
   */
  async referencingAccessRules(id: number): Promise<number[]> {
    return this.db
      .select({ accessRuleId: accessRulePortals.accessRuleId })
      .from(accessRulePortals)
      .where(eq(accessRulePortals.portalId, id))
      .all()
      .map((r) => r.accessRuleId);
  }
}
