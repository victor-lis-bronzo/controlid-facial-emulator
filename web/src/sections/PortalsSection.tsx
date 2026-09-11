import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { adminPortals } from '../api/client.ts';
import type { PortalView } from '../api/types.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { Modal } from '../components/Modal.tsx';
import { ResourceTable } from '../components/ResourceTable.tsx';

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * Portals section (Req 6.1, 6.3, 6.5, 6.6): list/create/edit/delete over
 * `adminPortals`. On an {@link ApiError} the {@link ErrorBanner} is shown and
 * the form is not cleared (Req 11.5).
 */
export function PortalsSection() {
  const [portals, setPortals] = useState<PortalView[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [listError, setListError] = useState<unknown>(null);

  const [editing, setEditing] = useState<PortalView | 'new' | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    try {
      setPortals(await adminPortals.list());
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
    setEditing('new');
    setName('');
    setFormError(null);
  };

  const openEdit = (portal: PortalView): void => {
    setEditing(portal);
    setName(portal.name);
    setFormError(null);
  };

  const closeForm = (): void => {
    setEditing(null);
    setFormError(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await adminPortals.create({ name });
      } else if (editing !== null) {
        await adminPortals.update(editing.id, { name });
      }
      closeForm();
      await load();
    } catch (error) {
      // Keep the form open and the input intact so it can be corrected (Req 11.5).
      setFormError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (portal: PortalView): Promise<void> => {
    setListError(null);
    try {
      await adminPortals.remove(portal.id);
      await load();
    } catch (error) {
      setListError(error);
    }
  };

  return (
    <section className="card" aria-labelledby="portals-title">
      <div className="section-header">
        <h2 className="card__title" id="portals-title" style={{ margin: 0 }}>
          Portals
        </h2>
        <button type="button" className="button" onClick={openCreate}>
          New portal
        </button>
      </div>

      {status === 'loading' && <p className="alert alert--info">Loading portals…</p>}
      {status === 'error' && <ErrorBanner error={loadError} context="Failed to load portals" />}
      <ErrorBanner error={listError} context="Delete failed" />

      {status === 'ready' && (
        <ResourceTable<PortalView>
          columns={[
            { key: 'id', header: 'ID', render: (p) => p.id },
            { key: 'name', header: 'Name', render: (p) => p.name },
          ]}
          rows={portals}
          rowKey={(p) => p.id}
          onEdit={openEdit}
          onDelete={(p) => void remove(p)}
          emptyMessage="No portals yet. Create one to model a door."
        />
      )}

      {editing !== null && (
        <Modal
          title={editing === 'new' ? 'New portal' : `Edit portal #${String(editing.id)}`}
          onClose={closeForm}
        >
          <form onSubmit={(e) => void submit(e)}>
            <ErrorBanner error={formError} context="Save failed" />
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="select"
                type="text"
                value={name}
                maxLength={128}
                disabled={saving}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
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
