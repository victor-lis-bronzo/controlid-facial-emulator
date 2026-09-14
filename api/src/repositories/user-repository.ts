/**
 * UserRepository — user/identity and access-log operations layered over
 * {@link ObjectStore}, extended for Admin Management Panel User CRUD, group
 * membership, and real facial-photo storage (Req 2, 3, 4.7).
 *
 * Responsibilities (design.md → "ObjectStore / UserRepository" and
 * "UserRepository extensions"):
 *
 *   - `list()` — return all user/identity records, feeding the Control Panel
 *     identity picker (Req 7.3). UNCHANGED.
 *   - `getImage(userId)` / `getImageWithMime(userId)` — return the stored
 *     face-image bytes (and MIME) for a user by delegating to
 *     {@link PhotoStorage.read}, or `null` when the user has no stored photo
 *     (Req 3.5).
 *   - `appendAccessLog(entry)` — insert an `access_logs` row. UNCHANGED.
 *   - `getBiometry(userId)` — synthetic biometry placeholder (Req 4.3). UNCHANGED.
 *   - Admin CRUD: `listAdmin()`, `getAdmin(id)`, `create(write)`,
 *     `update(id, write)`, `delete(id)`, `setImagePath(id, path)`, and
 *     `existingIds(ids)` (Req 2.1, 2.4, 2.5, 2.7, 2.8, 3.1, 3.6, 4.7). PIN is
 *     stored in the existing `password` column (Req 2.2). Multi-table writes
 *     (user row + `users_groups` membership) run inside a Drizzle transaction so
 *     a failure persists nothing.
 *
 * See requirements Req 2, 3, 4.7, and Req 7.3.
 */
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { users, usersGroups } from '../db/schema.js';
import type { AccessLogRecord, UserRecord } from '../shared/index.js';
import { ObjectStore } from './object-store.js';
import type { PhotoMime, PhotoStorage } from './photo-storage.js';

/**
 * Fields accepted when appending an access-log entry. All are optional except
 * the ones with no sensible device default; the repository fills the device
 * shape defaults for anything omitted (mirroring the `access_logs` column
 * defaults in the schema).
 */
export interface AccessLogEntry {
  /** Event time as Unix epoch seconds (string). Defaults to "now". */
  time?: string;
  /** Event code — '7' granted, '6' denied, '3' not identified. */
  event: string;
  /** Synthetic device id. */
  device_id: string;
  /** Identifier id (defaults to "0"). */
  identifier_id?: string;
  /** Associated user id (defaults to "0"). */
  user_id?: string;
  /** Portal id (defaults to "1"). */
  portal_id?: string;
  /** Identification rule id (defaults to "0"). */
  identification_rule_id?: string;
  /** Card value (defaults to "0"). */
  card_value?: string;
  /** Log type id (defaults to "-1"). */
  log_type_id?: string;
}

/**
 * Structurally-valid SYNTHETIC biometry data for a user (Req 4.3).
 *
 * The emulator is deliberately NOT a biometric engine: `template` is a
 * deterministic synthetic placeholder, not a real face template. The shape is
 * stable so integrating clients can parse and store it.
 */
export interface BiometryData {
  /** The user id the biometry belongs to. */
  user_id: string;
  /** Biometry modality — always facial for this emulator. */
  type: 'face';
  /** Base64-encoded synthetic template placeholder (NOT a real template). */
  template: string;
  /** Marks this as synthetic, non-biometric data. */
  synthetic: true;
}

/**
 * Admin-facing projection of a User for the Admin Management Panel (Req 2.4).
 * `hasPhoto` reflects whether `image_path` is set; `groupIds` lists the User's
 * Group memberships.
 */
export interface AdminUserView {
  id: number;
  registration: string;
  name: string;
  /** True when the User has a stored Facial_Photo (`image_path` not null). */
  hasPhoto: boolean;
  /** Ids of the Groups the User belongs to (Req 2.4, 2.5). */
  groupIds: number[];
}

/**
 * The submitted shape of a create/update User request (Req 2.1, 2.7). `pin` is
 * stored in the existing `password` column (Req 2.2); `groupIds` is the exact
 * membership set to persist (replacing any prior membership on update).
 */
export interface UserWrite {
  registration: string;
  name: string;
  /** Optional PIN, stored in `users.password` (Req 2.2). */
  pin?: string;
  /** Group membership set to persist (Req 2.7). */
  groupIds: number[];
}

export class UserRepository {
  private readonly store: ObjectStore;

  constructor(
    private readonly db: DrizzleDb,
    private readonly photos: PhotoStorage,
  ) {
    this.store = new ObjectStore(db);
  }

  /**
   * Return all user/identity records (Req 7.3). Records are shaped as
   * {@link UserRecord}s: numeric `id`, string `registration`/`name`, and
   * optional `password`/`image_path`.
   */
  async list(): Promise<UserRecord[]> {
    const rows = this.db.select().from(users).all();
    return rows.map((row) => {
      const record: UserRecord = {
        id: row.id,
        registration: row.registration,
        name: row.name,
      };
      if (row.password !== null && row.password !== undefined) {
        record.password = row.password;
      }
      if (row.imagePath !== null && row.imagePath !== undefined) {
        record.image_path = row.imagePath;
      }
      return record;
    });
  }

  /**
   * Return the stored face-image bytes for a user, or `null` when the user has
   * no stored photo. Delegates to {@link PhotoStorage.read} so the existing
   * `user_get_image.fcgi` route serves real bytes (Req 3.5).
   */
  async getImage(userId: number): Promise<Buffer | null> {
    const stored = await this.photos.read(userId);
    return stored === null ? null : stored.bytes;
  }

  /**
   * Return the stored face-image bytes AND MIME for a user, or `null` when the
   * user has no stored photo. Lets the image route set the correct content type
   * matching the stored format (Req 3.5).
   */
  async getImageWithMime(
    userId: number,
  ): Promise<{ bytes: Buffer; mime: PhotoMime } | null> {
    return this.photos.read(userId);
  }

  /**
   * Return structurally-valid SYNTHETIC biometry data for a user (Req 4.3).
   * This never performs real biometric extraction; the template is a stable
   * synthetic placeholder derived deterministically from the user id.
   */
  async getBiometry(userId: number): Promise<BiometryData> {
    const template = Buffer.from(`synthetic-face-template:${userId}`, 'utf8').toString(
      'base64',
    );
    return {
      user_id: String(userId),
      type: 'face',
      template,
      synthetic: true,
    };
  }

  /**
   * Insert an `access_logs` row, filling the device-shape defaults for any
   * omitted field, and return the created record as an {@link AccessLogRecord}
   * (all string fields; Req 4.1).
   */
  async appendAccessLog(entry: AccessLogEntry): Promise<AccessLogRecord> {
    const values: Record<string, string> = {
      time: entry.time ?? String(Math.floor(Date.now() / 1000)),
      event: entry.event,
      device_id: entry.device_id,
      identifier_id: entry.identifier_id ?? '0',
      user_id: entry.user_id ?? '0',
      portal_id: entry.portal_id ?? '1',
      identification_rule_id: entry.identification_rule_id ?? '0',
      card_value: entry.card_value ?? '0',
      log_type_id: entry.log_type_id ?? '-1',
    };

    const { ids } = await this.store.create('access_logs', [values]);
    const id = ids[0];

    return {
      id: String(id),
      time: values.time,
      event: values.event,
      device_id: values.device_id,
      identifier_id: values.identifier_id,
      user_id: values.user_id,
      portal_id: values.portal_id,
      identification_rule_id: values.identification_rule_id,
      card_value: values.card_value,
      log_type_id: values.log_type_id,
    };
  }

  // -------------------------------------------------------------------------
  // Admin Management Panel: User CRUD + group membership (Req 2, 4.7).
  // -------------------------------------------------------------------------

  /** Return every User as an {@link AdminUserView}, including memberships (Req 2.4). */
  async listAdmin(): Promise<AdminUserView[]> {
    const rows = this.db.select().from(users).all();
    const memberships = this.db.select().from(usersGroups).all();
    const byUser = new Map<number, number[]>();
    for (const m of memberships) {
      const list = byUser.get(m.userId) ?? [];
      list.push(m.groupId);
      byUser.set(m.userId, list);
    }
    return rows.map((row) => this.toView(row, byUser.get(row.id) ?? []));
  }

  /** Return a single User by id, or `null` when it does not exist (Req 2.5, 2.6). */
  async getAdmin(id: number): Promise<AdminUserView | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    if (!row) {
      return null;
    }
    const groupIds = this.db
      .select()
      .from(usersGroups)
      .where(eq(usersGroups.userId, id))
      .all()
      .map((m) => m.groupId);
    return this.toView(row, groupIds);
  }

  /**
   * Create a User with the submitted fields and membership, returning the
   * created view (Req 2.1). PIN → `password` (Req 2.2). Runs in a transaction so
   * the user row and its `users_groups` rows are written atomically.
   */
  async create(write: UserWrite): Promise<AdminUserView> {
    const distinct = [...new Set(write.groupIds)];
    const id = this.db.transaction((tx) => {
      const inserted = tx
        .insert(users)
        .values({
          registration: write.registration,
          name: write.name,
          password: write.pin ?? null,
        })
        .run();
      const newId = Number(inserted.lastInsertRowid);
      for (const groupId of distinct) {
        tx.insert(usersGroups).values({ userId: newId, groupId }).run();
      }
      return newId;
    });
    const view = await this.getAdmin(id);
    // The row was just created inside the same connection, so it always exists.
    return view as AdminUserView;
  }

  /**
   * Replace a User's registration, name, PIN, and membership with the submitted
   * values (Req 2.7). Runs in a transaction so a failure persists nothing.
   */
  async update(id: number, write: UserWrite): Promise<AdminUserView> {
    const distinct = [...new Set(write.groupIds)];
    this.db.transaction((tx) => {
      tx.update(users)
        .set({
          registration: write.registration,
          name: write.name,
          password: write.pin ?? null,
        })
        .where(eq(users.id, id))
        .run();
      tx.delete(usersGroups).where(eq(usersGroups.userId, id)).run();
      for (const groupId of distinct) {
        tx.insert(usersGroups).values({ userId: id, groupId }).run();
      }
    });
    const view = await this.getAdmin(id);
    return view as AdminUserView;
  }

  /**
   * Delete a User and its `users_groups` rows (Req 2.8). The membership rows are
   * removed explicitly within the transaction (the FK also cascades). The photo
   * file is removed by {@link UserAdminService} which orchestrates delete.
   */
  async delete(id: number): Promise<void> {
    this.db.transaction((tx) => {
      tx.delete(usersGroups).where(eq(usersGroups.userId, id)).run();
      tx.delete(users).where(eq(users.id, id)).run();
    });
  }

  /** Set (or clear) a User's stored image path (Req 3.1, 3.6). */
  async setImagePath(id: number, path: string | null): Promise<void> {
    this.db.update(users).set({ imagePath: path }).where(eq(users.id, id)).run();
  }

  /**
   * Return the subset of `ids` that correspond to existing Users, so services
   * can validate submitted membership sets (Req 4.7).
   */
  async existingIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = this.db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, ids))
      .all();
    return new Set(rows.map((r) => r.id));
  }

  /** Shape a raw user row + membership ids into an {@link AdminUserView}. */
  private toView(
    row: { id: number; registration: string; name: string; imagePath: string | null },
    groupIds: number[],
  ): AdminUserView {
    return {
      id: row.id,
      registration: row.registration,
      name: row.name,
      hasPhoto: row.imagePath !== null && row.imagePath !== undefined,
      groupIds,
    };
  }
}
