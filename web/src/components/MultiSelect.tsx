/** An option in a {@link MultiSelect}. */
export interface MultiSelectOption {
  id: number;
  label: string;
}

interface MultiSelectProps {
  /** The field label. */
  label: string;
  /** Available options. */
  options: MultiSelectOption[];
  /** Currently selected ids. */
  selected: number[];
  /** Called with the next selected id set on any toggle. */
  onChange: (ids: number[]) => void;
  /** Disables all checkboxes. */
  disabled?: boolean;
  /** Message shown when there are no options to choose from. */
  emptyMessage?: string;
}

/**
 * A checkbox-list multi-select used for Group membership, and Access Rule
 * Group/Time Zone/Portal associations. Presented as a scrollable list of
 * checkboxes so it stays reachable without horizontal scrolling (Req 11.6).
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  emptyMessage = 'No options available.',
}: MultiSelectProps) {
  const toggle = (id: number): void => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {options.length === 0 ? (
        <p className="empty-state empty-state--compact">{emptyMessage}</p>
      ) : (
        <div className="multi-select">
          {options.map((option) => (
            <label key={option.id} className="multi-select__option">
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                disabled={disabled}
                onChange={() => toggle(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
