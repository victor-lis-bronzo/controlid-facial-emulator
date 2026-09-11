import type { UserRecord } from '../api/types.ts';

interface IdentityPickerProps {
  /** Identities available for selection. */
  identities: UserRecord[];
  /** Currently selected identity id, or `null` when none is selected. */
  selectedId: number | null;
  /** Called with the newly selected identity id (or `null` for the placeholder). */
  onSelect: (id: number | null) => void;
  /** Disables the control (e.g. while a request is in flight). */
  disabled?: boolean;
}

/**
 * A `<select>` listing identities from `GET /api/identities`. A single identity
 * must be chosen before authorized-access simulation can be activated (Req 7.3).
 * The default option carries an empty value representing "no selection".
 */
export function IdentityPicker({
  identities,
  selectedId,
  onSelect,
  disabled = false,
}: IdentityPickerProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor="identity-select">
        Identity
      </label>
      <select
        id="identity-select"
        className="select"
        aria-label="Identity"
        value={selectedId === null ? '' : String(selectedId)}
        disabled={disabled || identities.length === 0}
        onChange={(event) => {
          const { value } = event.target;
          onSelect(value === '' ? null : Number(value));
        }}
      >
        <option value="">Select an identity…</option>
        {identities.map((identity) => (
          <option key={identity.id} value={String(identity.id)}>
            {identity.name} (#{identity.registration})
          </option>
        ))}
      </select>
    </div>
  );
}
