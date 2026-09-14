import type { TimeRangeWriteDto } from '../api/types.ts';

/** The seven weekday keys the backend accepts (Req 5.4). */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Human labels for the weekday keys, in the same order. */
const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

interface TimeRangeEditorProps {
  /** Current ranges being edited. */
  ranges: TimeRangeWriteDto[];
  /** Called with the next ranges array on any change. */
  onChange: (ranges: TimeRangeWriteDto[]) => void;
  /** Disables all controls (e.g. while a request is in flight). */
  disabled?: boolean;
}

/** A fresh empty range with no days selected and default times. */
function emptyRange(): TimeRangeWriteDto {
  return { days: [], startTime: '08:00', endTime: '18:00' };
}

/**
 * Edits a Time Zone's list of weekly {@link TimeRangeWriteDto} ranges: weekday
 * checkboxes plus `HH:MM` start/end inputs, with add/remove controls (Req 5.2–
 * 5.4). Validation is enforced server-side; this editor only collects input and
 * lets the section surface any 400 inline (Req 11.5).
 */
export function TimeRangeEditor({
  ranges,
  onChange,
  disabled = false,
}: TimeRangeEditorProps) {
  const updateRange = (index: number, patch: Partial<TimeRangeWriteDto>): void => {
    onChange(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const toggleDay = (index: number, day: string): void => {
    const current = ranges[index].days;
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day];
    updateRange(index, { days: next });
  };

  return (
    <div className="time-range-editor">
      {ranges.length === 0 && (
        <p className="field__label">No time ranges — access applies at no time.</p>
      )}

      {ranges.map((range, index) => (
        <fieldset key={index} className="time-range">
          <legend className="field__label">Range {index + 1}</legend>

          <div className="weekday-row">
            {WEEKDAYS.map((day) => (
              <label key={day} className="weekday">
                <input
                  type="checkbox"
                  checked={range.days.includes(day)}
                  disabled={disabled}
                  onChange={() => toggleDay(index, day)}
                />
                {WEEKDAY_LABELS[day]}
              </label>
            ))}
          </div>

          <div className="time-inputs">
            <label className="field">
              <span className="field__label">Start</span>
              <input
                className="select"
                type="time"
                value={range.startTime}
                disabled={disabled}
                onChange={(e) => updateRange(index, { startTime: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">End</span>
              <input
                className="select"
                type="time"
                value={range.endTime}
                disabled={disabled}
                onChange={(e) => updateRange(index, { endTime: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="button button--danger button--small"
              disabled={disabled}
              onClick={() => onChange(ranges.filter((_, i) => i !== index))}
            >
              Remove range
            </button>
          </div>
        </fieldset>
      ))}

      <button
        type="button"
        className="button button--secondary button--small"
        disabled={disabled}
        onClick={() => onChange([...ranges, emptyRange()])}
      >
        Add time range
      </button>
    </div>
  );
}
