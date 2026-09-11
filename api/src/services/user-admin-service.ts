/**
 * UserAdminService — validation + orchestration for Admin Management Panel User
 * CRUD and facial-photo handling (Req 2, 3).
 *
 * This service owns the business rules; the {@link UserRepository},
 * {@link GroupRepository}, and {@link PhotoStorage} perform typed DB access and
 * disk I/O respectively. It throws the shared domain errors so the existing
 * `classify()` maps them to the right HTTP status:
 *
 *   - Registration 1–64 and name 1–128 via `validateName` (Req 2.1, 2.3) →
 *     `BadRequestError` (400).
 *   - PIN stored in `users.password` (Req 2.2).
 *   - Every submitted `groupId` must exist → `BadRequestError` naming the
 *     missing id (Req 4.7) → 400.
 *   - Unknown user id on get/update/delete/photo → `NotFoundError` (Req 2.6) → 404.
 *   - `setPhoto`/`deletePhoto` confirm the user exists first, then orchestrate
 *     {@link PhotoStorage} + `setImagePath` (Req 3.1, 3.6).
 *   - `delete` removes the photo file and memberships alongside the user
 *     (Req 2.8, 3.7).
 *
 * See design.md → "Admin services → UserAdminService".
 */
import { BadRequestError, NotFoundError } from '../routes/errors.js';
import type { PhotoMime, PhotoStorage } from '../repositories/photo-storage.js';
import type { GroupRepository } from '../repositories/group-repository.js';
import type {
  AdminUserView,
  UserRepository,
  UserWrite,
} from '../repositories/user-repository.js';
import { validateName } from './validation.js';

/** Maximum registration length (Req 2.1). */
const MAX_REGISTRATION = 64;
/** Maximum name length (Req 2.1). */
const MAX_NAME = 128;

/** The submitted create/update User body (route-facing). */
export interface UserAdminWrite {
  registration: string;
  name: string;
  pin?: string;
  groupIds?: number[];
}

export class UserAdminService {
  public constructor(
    private readonly users: UserRepository,
    private readonly groups: GroupRepository,
    private readonly photos: PhotoStorage,
  ) {}

  /** List every User with membership + photo presence (Req 2.4). */
  async list(): Promise<AdminUserView[]> {
    return this.users.listAdmin();
  }

  /** Get a single User, or throw {@link NotFoundError} (Req 2.5, 2.6). */
  async get(id: number): Promise<AdminUserView> {
    const view = await this.users.getAdmin(id);
    if (view === null) {
      throw new NotFoundError(`User ${String(id)} not found.`);
    }
    return view;
  }

  /** Create a User after validating fields and membership (Req 2.1, 2.3, 4.7). */
  async create(body: UserAdminWrite): Promise<AdminUserView> {
    const write = await this.validate(body);
    return this.users.create(write);
  }

  /** Replace an existing User's fields and membership (Req 2.7). */
  async update(id: number, body: UserAdminWrite): Promise<AdminUserView> {
    await this.get(id); // 404 if absent (Req 2.6)
    const write = await this.validate(body);
    return this.users.update(id, write);
  }

  /**
   * Delete a User, removing its stored photo file and memberships (Req 2.8,
   * 3.7). Throws {@link NotFoundError} when the user does not exist (Req 2.6).
   */
  async delete(id: number): Promise<void> {
    await this.get(id);
    await this.photos.delete(id);
    await this.users.delete(id);
  }

  /**
   * Store a facial photo for an existing User and set its image path (Req 3.1).
   * The user must exist (Req 2.6). Byte/MIME validation (JPEG/PNG, ≤ 5 MB)
   * happens in the route layer before this is called.
   */
  async setPhoto(id: number, bytes: Buffer, mime: PhotoMime): Promise<void> {
    await this.get(id);
    const stored = await this.photos.save(id, bytes, mime);
    await this.users.setImagePath(id, stored.relativePath);
  }

  /** Remove a User's stored photo and clear its image path (Req 3.6). */
  async deletePhoto(id: number): Promise<void> {
    await this.get(id);
    await this.photos.delete(id);
    await this.users.setImagePath(id, null);
  }

  /**
   * Validate a submitted body into a {@link UserWrite}: field bounds (Req 2.1,
   * 2.3) and that every submitted `groupId` exists (Req 4.7). Throws
   * {@link BadRequestError} (400) on any violation, before any write.
   */
  private async validate(body: UserAdminWrite): Promise<UserWrite> {
    const registration = validateName('registration', body.registration, MAX_REGISTRATION);
    const name = validateName('name', body.name, MAX_NAME);

    const groupIds = body.groupIds ?? [];
    if (!Array.isArray(groupIds)) {
      throw new BadRequestError('Field "groupIds" must be an array of group ids.');
    }
    if (groupIds.length > 0) {
      const existing = await this.groups.existingIds(groupIds);
      for (const groupId of groupIds) {
        if (!existing.has(groupId)) {
          throw new BadRequestError(`Group ${String(groupId)} does not exist.`);
        }
      }
    }

    const write: UserWrite = { registration, name, groupIds };
    if (body.pin !== undefined) {
      write.pin = body.pin;
    }
    return write;
  }
}
