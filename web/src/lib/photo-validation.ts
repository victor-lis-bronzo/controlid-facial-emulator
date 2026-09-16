export const ACCEPTED_PHOTO_MIMES = ['image/jpeg', 'image/png'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Client-side validation mirroring the server's accepted formats/size for
 * `user_set_image.fcgi`. Returns the exact error message to display, or
 * `null` when the file is valid.
 */
export function validatePhotoFile(file: File): string | null {
  if (!ACCEPTED_PHOTO_MIMES.includes(file.type)) {
    return 'Formato inválido. Aceito apenas JPEG ou PNG.';
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return 'A foto não pode exceder 5 MB.';
  }
  return null;
}
