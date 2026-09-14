import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { adminTimeZones } from '../api/client.ts';
import type { TimeRangeWriteDto, TimeZoneView } from '../api/types.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { Modal } from '../components/Modal.tsx';
import { ResourceTable } from '../components/ResourceTable.tsx';
import { TimeRangeEditor } from '../components/TimeRangeEditor.tsx';

type LoadStatus = 'loading' | 'ready' | 'error';

interface FormState {
  id: number | null;
  name: string;
  timeRanges: TimeRangeWriteDto[];
}

/** Summarize a time zone's ranges for the list column. */
function summarizeRanges(zone: TimeZoneView): string {
  if (zone.timeRanges.length === 0) {
    return '—';
  }
  return zone.timeRanges
    .map((r) => `${r.days.join('/')} ${r.startTime}–${r.endTime}`)
    .join('; ');
}

/**
 * Time Zones section (Req 5): list/create/edit/delete using the
 * {@link TimeRangeEditor}. Range/day validation errors (400) from the server are
 * surfaced inline (Req 11.5) without clearing the form.
 */
export function TimeZonesSection() {
  const [zones, setZones] = useState<TimeZoneView[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [listError, setListError] = useState<unknown>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    try {
      setZones(await adminTimeZones.list());
      setStatus('ready');
    } catch (error) {
      setLoadError(error);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = (): void => {
    setForm({ id: null, name: '', timeRanges: [] });
    setFormError(null);
  };

  const openEdit = (zone: TimeZoneView): void => {
    setForm({
      id: zone.id,
      name: zone.name,
      timeRanges: zone.timeRanges.map((r) => ({
        days: [...r.days],
        startTime: r.startTime,
        endTime: r.endTime,
      })),
    });
    setFormError(null);
  };

  const closeForm = (): void => {
    setForm(null);
    setFormError(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (form === null) {
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body = { name: form.name, timeRanges: form.timeRanges };
      if (form.id === null) {
        await adminTimeZones.create(body);
      } else {
        await adminTimeZones.update(form.id, body);
      }
      closeForm();
      await load();
    } catch (error) {
      setFormError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (zone: TimeZoneView): Promise<void> => {
    setListError(null);
    try {
      await adminTimeZones.remove(zone.id);
      await load();
    } catch (error) {
      setListError(error);
    }
  };

  return (
    <section className="card" aria-labelledby="time-zones-title">
      <div className="section-header">
        <h2 className="card__title" id="time-zones-title" style={{ margin: 0 }}>
          Time Zones
        </h2>
        <button type="button" className="button" onClick={openCreate}>
          New time zone
        </button>
      </div>

      {status === 'loading' && <p className="alert alert--info">Loading time zones…</p>}
      {status === 'error' && (
        <ErrorBanner error={loadError} context="Failed to load time zones" />
      )}
      <ErrorBanner error={listError} context="Action failed" />

      {status === 'ready' && (
        <ResourceTable<TimeZoneView>
          columns={[
            { key: 'id', header: 'ID', render: (z) => z.id },
            { key: 'name', header: 'Name', render: (z) => z.name },
            { key: 'ranges', header: 'Ranges', render: (z) => summarizeRanges(z) },
          ]}
          rows={zones}
          rowKey={(z) => z.id}
          onEdit={openEdit}
          onDelete={(z) => void remove(z)}
          emptyMessage="No time zones yet. Create one to define a weekly schedule."
        />
      )}

      {form !== null && (
        <Modal
          title={form.id === null ? 'New time zone' : `Edit time zone #${String(form.id)}`}
          onClose={closeForm}
        >
          <form onSubmit={(e) => void submit(e)}>
            <ErrorBanner error={formError} context="Save failed" />
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="select"
                type="text"
                value={form.name}
                maxLength={128}
                disabled={saving}
                autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <TimeRangeEditor
              ranges={form.timeRanges}
              disabled={saving}
              onChange={(timeRanges) => setForm({ ...form, timeRanges })}
            />
            <div className="button-row">
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={saving}
                onClick={closeForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
