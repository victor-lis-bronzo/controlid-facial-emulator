/**
 * Shared facial-photo upload validation, used by both the `/api/admin` photo
 * endpoints and the `.fcgi` `user_set_image.fcgi` route.
 */
import type { PhotoMime } from '../repositories/photo-storage.js';

/** Maximum accepted facial-photo size in bytes (5 MB) (Req 3.1, 3.3). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The two accepted image MIME types (Req 3.2). */
export const ACCEPTED_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/** Human-readable list of accepted photo formats, used in the 400 message. */
export const ACCEPTED_FORMATS_MESSAGE = 'Accepted formats: JPEG, PNG.';

/**
 * Sniff the leading magic bytes to confirm the declared image type, returning
 * the detected MIME or `null` when the bytes match neither JPEG nor PNG. This
 * defends against a spoofed `mimetype` (Req 3.2).
 *
 *   - JPEG: `FF D8 FF`
 *   - PNG:  `89 50 4E 47`
 */
export function sniffImageMime(bytes: Buffer): PhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  return null;
}

/** True for a thrown value carrying the multipart oversize error code. */
export function isFileTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}
