/**
 * PortalService — validation + referential integrity for Portal CRUD (Req 6, 7.7).
 *
 * Owns the business rules; {@link PortalRepository} performs typed DB access.
 * Throws the shared domain errors so the existing `classify()` maps them:
 *
 *   - Name 1–128 via `validateName` (Req 6.2) → `BadRequestError` (400).
 *   - Unknown portal id on get/update/delete → `NotFoundError` (Req 6.4) → 404.
 *   - Deleting a Portal referenced by ≥ 1 Access Rule → `ConflictError` naming the
 *     referencing rules (Req 7.7) → 409, with no change persisted.
 *
 * See design.md → "Admin services → PortalService".
 */
import { ConflictError, NotFoundError } from '../routes/errors.js';
import type { PortalRepository, PortalView } from '../repositories/portal-repository.js';
import { validateName } from './validation.js';

/** Maximum portal name length (Req 6.2). */
const MAX_NAME = 128;

export class PortalService {
  public constructor(private readonly portals: PortalRepository) {}

  /** List every Portal (Req 6.3). */
  async list(): Promise<PortalView[]> {
    return this.portals.list();
  }

  /** Get a single Portal, or throw {@link NotFoundError} (Req 6.4). */
  async get(id: number): Promise<PortalView> {
    const view = await this.portals.get(id);
    if (view === null) {
      throw new NotFoundError(`Portal ${String(id)} not found.`);
    }
    return view;
  }

  /** Create a Portal after validating its name (Req 6.1, 6.2). */
  async create(name: unknown): Promise<PortalView> {
    const validated = validateName('name', name, MAX_NAME);
    return this.portals.create(validated);
  }

  /** Replace a Portal's name (Req 6.5); 404 when absent, 400 on bad name. */
  async update(id: number, name: unknown): Promise<PortalView> {
    await this.get(id);
    const validated = validateName('name', name, MAX_NAME);
    return this.portals.update(id, validated);
  }

  /**
   * Delete a Portal (Req 6.6). Rejects with {@link ConflictError} (409) when the
   * Portal is referenced by ≥ 1 Access Rule, naming those rules (Req 7.7).
   */
  async delete(id: number): Promise<void> {
    await this.get(id);
    const referencing = await this.portals.referencingAccessRules(id);
    if (referencing.length > 0) {
      throw new ConflictError(
        `Portal ${String(id)} is referenced by Access Rule(s): ${referencing.join(', ')}.`,
      );
    }
    await this.portals.delete(id);
  }
}
