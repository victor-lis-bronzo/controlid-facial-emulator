/**
 * Access-event code helpers shared by the Access Logs and Dashboard sections.
 * Codes mirror the device's `access_logs.event` values (Req 8.3): granted `7`,
 * denied `6`, not identified `3`, REX `11`.
 */

/** Selectable event filter options for the Access Logs table (Req 8.3). */
export const ACCESS_EVENT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '7', label: 'Granted (7)' },
  { value: '6', label: 'Denied (6)' },
  { value: '3', label: 'Not identified (3)' },
  { value: '11', label: 'REX (11)' },
];

/** Map an event code string to a human label, falling back to the raw code. */
export function eventLabel(code: string): string {
  const match = ACCESS_EVENT_OPTIONS.find((option) => option.value === code);
  return match !== undefined ? match.label : code;
}

/**
 * Format a device epoch-seconds string as a locale date-time; falls back to the
 * raw value if it is not a finite number.
 */
export function formatEpoch(seconds: string): string {
  const asNumber = Number(seconds);
  if (!Number.isFinite(asNumber)) {
    return seconds;
  }
  return new Date(asNumber * 1000).toLocaleString();
}
