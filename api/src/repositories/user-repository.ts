/**
 * UserRepository — user/identity and access-log operations layered over
 * {@link ObjectStore}.
 *
 * Responsibilities (design.md → "ObjectStore / UserRepository"):
 *
 *   - `list()` — return all user/identity records, feeding the Control Panel
 *     identity picker (Req 7.3).
 *   - `getImage(userId)` — return the stored face-image bytes for a user, or
 *     `null` when the user has no image / does not exist. The emulator is not a
 *     biometric engine, so this is a documented stub: it returns `null` unless
 *     a real image path is later wired in.
 *   - `appendAccessLog(entry)` — insert an `access_logs` row (filling the device
 *     shape defaults) and return the created record as an {@link AccessLogRecord}
 *     with all string fields, matching the device `dao` wire shape (Req 4.1).
 *   - `getBiometry(userId)` — return structurally-valid SYNTHETIC biometry data
 *     (Req 4.3). The emulator does not perform real template extraction; this
 *     returns a small, well-formed structure so integrating clients can
 *     exercise the biometry read path.
 *
 * See requirements Req 4 and Req 7.3.
 */
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import type { AccessLogRecord, UserRecord } from '../shared/index.js';
import { ObjectStore } from './object-store.js';

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

export class UserRepository {
  private readonly store: ObjectStore;

  constructor(private readonly db: DrizzleDb) {
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
   * no image or does not exist.
   *
   * This is a documented stub: the emulator does not ship real images, so it
   * returns `null` whenever `image_path` is unset. When a real path is present
   * a future implementation can read and return the file bytes.
   */
  async getImage(userId: number): Promise<Buffer | null> {
    const row = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!row || row.imagePath === null || row.imagePath === undefined) {
      return null;
    }
    // No image bytes are materialized in this emulator build; the presence of a
    // path is modeled but the content is not stored. Return null until a real
    // image source is wired in.
    return null;
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
}
