/**
 * GroupService — validation + referential integrity for Group CRUD (Req 4, 7.7).
 *
 * Owns the business rules; {@link GroupRepository} performs typed DB access and
 * {@link UserRepository} resolves member-id existence. Throws the shared domain
 * errors so the existing `classify()` maps them to the right HTTP status:
 *
 *   - Name 1–128 via `validateName` (Req 4.2) → `BadRequestError` (400).
 *   - Every submitted `memberId` must exist → `BadRequestError` naming the
 *     invalid id (Req 4.7) → 400.
 *   - Unknown group id on get/update/delete → `NotFoundError` (Req 4.5) → 404.
 *   - Deleting a Group referenced by ≥ 1 Access Rule → `ConflictError` naming the
 *     referencing rules (Req 7.7) → 409, with no change persisted.
 *
 * See design.md → "Admin services → GroupService".
 */
import { BadRequestError, ConflictError, NotFoundError } from '../routes/errors.js';
import type {
  GroupDetail,
  GroupRepository,
  GroupView,
} from '../repositories/group-repository.js';
import type { UserRepository } from '../repositories/user-repository.js';
import { validateName } from './validation.js';

/** Maximum group name length (Req 4.2). */
const MAX_NAME = 128;

export class GroupService {
  public constructor(
    private readonly groups: GroupRepository,
    private readonly users: UserRepository,
  ) {}

  /** List every Group with its member count (Req 4.3). */
  async list(): Promise<GroupView[]> {
    return this.groups.list();
  }

  /** Get a single Group with members, or throw {@link NotFoundError} (Req 4.4, 4.5). */
  async get(id: number): Promise<GroupDetail> {
    const detail = await this.groups.get(id);
    if (detail === null) {
      throw new NotFoundError(`Group ${String(id)} not found.`);
    }
    return detail;
  }

  /** Create a Group after validating its name (Req 4.1, 4.2). */
  async create(name: unknown): Promise<GroupDetail> {
    const validated = validateName('name', name, MAX_NAME);
    return this.groups.create(validated);
  }

  /**
   * Replace a Group's name and membership (Req 4.6). Validates the name, that
   * the group exists (Req 4.5), and that every member id exists (Req 4.7).
   */
  async update(id: number, name: unknown, memberIds: number[]): Promise<GroupDetail> {
    await this.get(id);
    const validated = validateName('name', name, MAX_NAME);
    await this.assertMembersExist(memberIds);
    return this.groups.update(id, validated, memberIds);
  }

  /**
   * Delete a Group (Req 4.8). Rejects with {@link ConflictError} (409) when the
   * Group is referenced by ≥ 1 Access Rule, naming those rules (Req 7.7); no
   * change is persisted in that case. Throws {@link NotFoundError} when absent.
   */
  async delete(id: number): Promise<void> {
    await this.get(id);
    const referencing = await this.groups.referencingAccessRules(id);
    if (referencing.length > 0) {
      throw new ConflictError(
        `Group ${String(id)} is referenced by Access Rule(s): ${referencing.join(', ')}.`,
      );
    }
    await this.groups.delete(id);
  }

  /** Assert every submitted member id exists, else 400 naming the first invalid one. */
  private async assertMembersExist(memberIds: number[]): Promise<void> {
    if (memberIds.length === 0) {
      return;
    }
    const existing = await this.users.existingIds(memberIds);
    for (const memberId of memberIds) {
      if (!existing.has(memberId)) {
        throw new BadRequestError(`User ${String(memberId)} does not exist.`);
      }
    }
  }
}
