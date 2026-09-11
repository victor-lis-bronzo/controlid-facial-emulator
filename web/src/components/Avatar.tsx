interface AvatarProps {
  /** The user id whose stored photo to display via `user_get_image.fcgi`. */
  userId: number;
  /** Whether a Facial_Photo is stored; when false an initials placeholder shows. */
  hasPhoto: boolean;
  /** The display name used to derive the initials placeholder. */
  name: string;
  /**
   * A cache-busting token; changing it forces the `<img>` to reload after an
   * upload/delete (the URL is otherwise stable, keyed only by user id).
   */
  refreshToken?: number;
}

/** Derive up to two uppercase initials from a display name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Renders a User's stored Facial_Photo via the existing
 * `GET /user_get_image.fcgi?user_id=<id>` endpoint when `hasPhoto` is true,
 * otherwise an initials placeholder (Req 3.4). The emulator performs no
 * biometric processing — this is display only.
 */
export function Avatar({ userId, hasPhoto, name, refreshToken }: AvatarProps) {
  if (hasPhoto) {
    const bust = refreshToken !== undefined ? `&_=${String(refreshToken)}` : '';
    return (
      <img
        className="avatar avatar--photo"
        src={`/user_get_image.fcgi?user_id=${String(userId)}${bust}`}
        alt={`Photo of ${name}`}
        width={40}
        height={40}
      />
    );
  }
  return (
    <span className="avatar avatar--initials" aria-label={`No photo for ${name}`}>
      {initialsOf(name)}
    </span>
  );
}
