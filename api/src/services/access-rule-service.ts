/**
 * AccessRuleService — validation + composition rules for Access Rule CRUD
 * (Req 7.1–7.6, 7.8).
 *
 * Owns the business rules; {@link AccessRuleRepository} performs typed DB access
 * while the Group/Time Zone/Portal repositories resolve reference existence.
 * Throws the shared domain errors so the existing `classify()` maps them:
 *
 *   - Name 1–128 via `validateName` (Req 7.1) → `BadRequestError` (400).
 *   - Each of the group/time-zone/portal id sets must be non-empty →
 *     `BadRequestError` naming the missing association (Req 7.3) → 400.
 *   - Every referenced group/time-zone/portal id must exist →
 *     `BadRequestError` naming the missing reference (Req 7.2) → 400.
 *   - Unknown access-rule id on get/update/delete → `NotFoundError` (Req 7.5) → 404.
 *   - Deleting an Access Rule leaves referenced entities intact (Req 7.8);
 *     enforced by the repository.
 *
 * All validation runs before any write, and the repository's association writes
 * are transactional, so a rejected create/update persists nothing.
 *
 * See design.md → "Admin services → AccessRuleService".
 */
import { BadRequestError, NotFoundError } from '../routes/errors.js';
import type {
  AccessRuleRepository,
  AccessRuleView,
  AccessRuleWrite,
} from '../repositories/access-rule-repository.js';
import type { GroupRepository } from '../repositories/group-repository.js';
import type { PortalRepository } from '../repositories/portal-repository.js';
import type { TimeZoneRepository } from '../repositories/time-zone-repository.js';
import { validateName } from './validation.js';

/** Maximum access-rule name length (Req 7.1). */
const MAX_NAME = 128;

/** The submitted create/update Access Rule body (route-facing). */
export interface AccessRuleAdminWrite {
  name: string;
  groupIds: number[];
  timeZoneIds: number[];
  portalIds: number[];
}

export class AccessRuleService {
  public constructor(
    private readonly accessRules: AccessRuleRepository,
    private readonly groups: GroupRepository,
    private readonly timeZones: TimeZoneRepository,
    private readonly portals: PortalRepository,
  ) {}

  /** List every Access Rule with its association id sets (Req 7.4). */
  async list(): Promise<AccessRuleView[]> {
    return this.accessRules.list();
  }

  /** Get a single Access Rule, or throw {@link NotFoundError} (Req 7.5). */
  async get(id: number): Promise<AccessRuleView> {
    const view = await this.accessRules.get(id);
    if (view === null) {
      throw new NotFoundError(`Access Rule ${String(id)} not found.`);
    }
    return view;
  }

  /** Create an Access Rule after full validation (Req 7.1–7.3). */
  async create(body: AccessRuleAdminWrite): Promise<AccessRuleView> {
    const write = await this.validate(body);
    return this.accessRules.create(write);
  }

  /** Replace an Access Rule's name and associations (Req 7.6); 404 when absent. */
  async update(id: number, body: AccessRuleAdminWrite): Promise<AccessRuleView> {
    await this.get(id);
    const write = await this.validate(body);
    return this.accessRules.update(id, write);
  }

  /**
   * Delete an Access Rule (Req 7.8); 404 when absent. Referenced
   * Groups/Time Zones/Portals are left unchanged (enforced by the repository).
   */
  async delete(id: number): Promise<void> {
    await this.get(id);
    await this.accessRules.delete(id);
  }

  /**
   * Validate a submitted body into an {@link AccessRuleWrite}: name bounds
   * (Req 7.1), non-empty association sets (Req 7.3), and existence of every
   * referenced id (Req 7.2). Throws {@link BadRequestError} (400) before any
   * write.
   */
  private async validate(body: AccessRuleAdminWrite): Promise<AccessRuleWrite> {
    const name = validateName('name', body.name, MAX_NAME);

    const groupIds = this.requireNonEmpty('groupIds', body.groupIds);
    const timeZoneIds = this.requireNonEmpty('timeZoneIds', body.timeZoneIds);
    const portalIds = this.requireNonEmpty('portalIds', body.portalIds);

    await this.assertExist('Group', groupIds, (ids) => this.groups.existingIds(ids));
    await this.assertExist('Time Zone', timeZoneIds, (ids) => this.timeZones.existingIds(ids));
    await this.assertExist('Portal', portalIds, (ids) => this.portals.existingIds(ids));

    return { name, groupIds, timeZoneIds, portalIds };
  }

  /** Require a non-empty association set, else 400 naming it (Req 7.3). */
  private requireNonEmpty(field: string, ids: number[]): number[] {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestError(
        `Field "${field}" must reference at least one existing entity.`,
      );
    }
    return ids;
  }

  /** Assert every referenced id exists, else 400 naming the missing reference (Req 7.2). */
  private async assertExist(
    label: string,
    ids: number[],
    resolve: (ids: number[]) => Promise<Set<number>>,
  ): Promise<void> {
    const existing = await resolve(ids);
    for (const id of ids) {
      if (!existing.has(id)) {
        throw new BadRequestError(`${label} ${String(id)} does not exist.`);
      }
    }
  }
}
