/**
 * InMemoryPhotoStorage — a non-disk {@link PhotoStorage} implementation.
 *
 * Keeps photo bytes in a `Map` keyed by user id, with identical semantics to
 * {@link DiskPhotoStorage}: at most one photo per user, re-upload overwrites,
 * `delete` is idempotent, and `read` returns `null` when absent. It is used as
 * the `photoStorage` test seam injected via `BuildContainerOverrides` so
 * integration and unit tests never touch the filesystem (design.md → "Container
 * wiring"; Testing Strategy → Integration). No biometric processing is
 * performed (Req 3.8, 15.1).
 */
import type { PhotoMime, PhotoStorage, StoredPhoto } from './photo-storage.js';

/** Map a MIME type to its canonical file extension (for the reported path). */
const MIME_TO_EXT: Readonly<Record<PhotoMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** An in-memory {@link PhotoStorage} suitable for tests and the DI test seam. */
export class InMemoryPhotoStorage implements PhotoStorage {
  private readonly store = new Map<number, { bytes: Buffer; mime: PhotoMime }>();

  public async save(userId: number, bytes: Buffer, mime: PhotoMime): Promise<StoredPhoto> {
    // Copy so external mutation of the caller's buffer cannot alter stored bytes.
    this.store.set(userId, { bytes: Buffer.from(bytes), mime });
    return {
      relativePath: `photos/${String(userId)}.${MIME_TO_EXT[mime]}`,
      mime,
    };
  }

  public async read(
    userId: number,
  ): Promise<{ bytes: Buffer; mime: PhotoMime } | null> {
    const entry = this.store.get(userId);
    if (entry === undefined) {
      return null;
    }
    return { bytes: Buffer.from(entry.bytes), mime: entry.mime };
  }

  public async delete(userId: number): Promise<void> {
    this.store.delete(userId);
  }
}
