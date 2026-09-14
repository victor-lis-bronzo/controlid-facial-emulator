/**
 * PhotoStorage — the single component that owns the on-disk facial-photo layout.
 *
 * A thin filesystem abstraction over `node:fs/promises`. It is the only place
 * that touches photo files, so the storage location and naming are centralized
 * (see design.md → "PhotoStorage" and "Photo Upload & Retrieval Design").
 *
 * Layout and semantics:
 *   - Photos live under a `photos/` subfolder of the configured root dir. The
 *     subfolder is created lazily on the first write (Req 13.3).
 *   - A user's file is named `<userId>.jpg` or `<userId>.png`, the extension
 *     inferred from the stored MIME. Because the name is keyed by user id, a
 *     re-upload overwrites the prior photo; to guarantee a user has AT MOST one
 *     photo, `save` removes any file with the other extension first.
 *   - `read(userId)` probes both extensions and recovers the MIME from the one
 *     found, so `user_get_image.fcgi` can serve the correct content type
 *     (Req 3.5); returns `null` when no photo exists.
 *   - `delete(userId)` is idempotent — it unlinks any existing photo for the
 *     user and silently no-ops when none is present.
 *
 * No biometric processing is performed: bytes are only stored, read, and
 * deleted (Req 3.8, Req 15.1).
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The two accepted image MIME types (Req 3.2). */
export type PhotoMime = 'image/jpeg' | 'image/png';

/** The result of persisting a photo. */
export interface StoredPhoto {
  /** Path persisted in `users.image_path`, relative to the photos dir root. */
  relativePath: string;
  mime: PhotoMime;
}

/**
 * Storage boundary for user facial photos. Implementations own the physical
 * location and naming; callers deal only in user ids, bytes, and MIME types.
 */
export interface PhotoStorage {
  /** Persist bytes for a user, overwriting any prior photo; returns the stored path. */
  save(userId: number, bytes: Buffer, mime: PhotoMime): Promise<StoredPhoto>;
  /** Read stored bytes + mime for a user, or null when none / file missing. */
  read(userId: number): Promise<{ bytes: Buffer; mime: PhotoMime } | null>;
  /** Delete a user's stored photo file if present (idempotent). */
  delete(userId: number): Promise<void>;
}

/** The name of the subfolder created under the root dir to hold photos. */
const PHOTOS_SUBDIR = 'photos';

/** Map a MIME type to its canonical file extension. */
const MIME_TO_EXT: Readonly<Record<PhotoMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Ordered list of (extension, mime) pairs to probe on read. */
const EXT_MIME_PAIRS: ReadonlyArray<{ ext: string; mime: PhotoMime }> = [
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'png', mime: 'image/png' },
];

/** True for a Node error carrying an `ENOENT` (file-not-found) code. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Disk-backed {@link PhotoStorage}. All files live under `<rootDir>/photos/`.
 * The `photos/` directory is created on demand before the first write.
 */
export class DiskPhotoStorage implements PhotoStorage {
  private readonly photosDir: string;

  /**
   * @param rootDir The data directory root under which the `photos/` subfolder
   *   is created. In persistent mode this is the mounted volume so photos
   *   survive restarts (Req 13.3).
   */
  public constructor(rootDir: string) {
    this.photosDir = join(rootDir, PHOTOS_SUBDIR);
  }

  public async save(userId: number, bytes: Buffer, mime: PhotoMime): Promise<StoredPhoto> {
    await mkdir(this.photosDir, { recursive: true });

    // Guarantee at most one photo per user: remove any file with the other
    // extension before writing, so switching formats never leaves a stale file.
    const ext = MIME_TO_EXT[mime];
    for (const pair of EXT_MIME_PAIRS) {
      if (pair.ext !== ext) {
        await this.unlinkQuietly(this.pathFor(userId, pair.ext));
      }
    }

    const fileName = this.fileName(userId, ext);
    await writeFile(join(this.photosDir, fileName), bytes);
    return {
      relativePath: join(PHOTOS_SUBDIR, fileName),
      mime,
    };
  }

  public async read(userId: number): Promise<{ bytes: Buffer; mime: PhotoMime } | null> {
    for (const pair of EXT_MIME_PAIRS) {
      try {
        const bytes = await readFile(this.pathFor(userId, pair.ext));
        return { bytes, mime: pair.mime };
      } catch (error) {
        if (isNotFound(error)) {
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  public async delete(userId: number): Promise<void> {
    for (const pair of EXT_MIME_PAIRS) {
      await this.unlinkQuietly(this.pathFor(userId, pair.ext));
    }
  }

  /** Absolute path of a user's photo file for a given extension. */
  private pathFor(userId: number, ext: string): string {
    return join(this.photosDir, this.fileName(userId, ext));
  }

  /** File name for a user + extension (e.g. `42.jpg`). */
  private fileName(userId: number, ext: string): string {
    return `${String(userId)}.${ext}`;
  }

  /** Unlink a path, ignoring a missing file so delete/overwrite is idempotent. */
  private async unlinkQuietly(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }
  }
}

/**
 * Factory for the default disk-backed {@link PhotoStorage} implementation.
 *
 * @param rootDir The data directory root under which `photos/` is created.
 */
export function createPhotoStorage(rootDir: string): PhotoStorage {
  return new DiskPhotoStorage(rootDir);
}
