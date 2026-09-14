import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  adminAccessRules,
  adminGroups,
  adminPortals,
  adminTimeZones,
} from '../api/client.ts';
import type {
  AccessRuleView,
  GroupView,
  PortalView,
  TimeZoneView,
} from '../api/types.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { Modal } from '../components/Modal.tsx';
import { MultiSelect } from '../components/MultiSelect.tsx';
import { ResourceTable } from '../components/ResourceTable.tsx';

type LoadStatus = 'loading' | 'ready' | 'error';

interface FormState {
  id: number | null;
  name: string;
  groupIds: number[];
  timeZoneIds: number[];
  portalIds: number[];
}

/**
 * Access Rules section (Req 7): list/create/edit/delete selecting Groups, Time
 * Zones, and Portals via multi-selects. Empty-set / unknown-reference 400
 * messages are surfaced inline (Req 11.5) without clearing the form.
 */
export function AccessRulesSection() {
  const [rules, setRules] = useState<AccessRuleView[]>([]);
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [zones, setZones] = useState<TimeZoneView[]>([]);
  const [portals, setPortals] = useState<PortalView[]>([]);
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
      const [ruleList, groupList, zoneList, portalList] = await Promise.all([
        adminAccessRules.list(),
        adminGroups.list(),
        adminTimeZones.list(),
        adminPortals.list(),
      ]);
      setRules(ruleList);
      setGroups(groupList);
      setZones(zoneList);
      setPortals(portalList);
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
    setForm({ id: null, name: '', groupIds: [], timeZoneIds: [], portalIds: [] });
    setFormError(null);
  };

  const openEdit = (rule: AccessRuleView): void => {
    setForm({
      id: rule.id,
      name: rule.name,
      groupIds: [...rule.groupIds],
      timeZoneIds: [...rule.timeZoneIds],
      portalIds: [...rule.portalIds],
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
      const body = {
        name: form.name,
        groupIds: form.groupIds,
        timeZoneIds: form.timeZoneIds,
        portalIds: form.portalIds,
      };
      if (form.id === null) {
        await adminAccessRules.create(body);
      } else {
        await adminAccessRules.update(form.id, body);
      }
      closeForm();
      await load();
    } catch (error) {
      setFormError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rule: AccessRuleView): Promise<void> => {
    setListError(null);
    try {
      await adminAccessRules.remove(rule.id);
      await load();
    } catch (error) {
      setListError(error);
    }
  };

  return (
    <section className="card" aria-labelledby="access-rules-title">
      <div className="section-header">
        <h2 className="card__title" id="access-rules-title" style={{ margin: 0 }}>
          Access Rules
        </h2>
        <button type="button" className="button" onClick={openCreate}>
          New access rule
        </button>
      </div>

      {status === 'loading' && <p className="alert alert--info">Loading access rules…</p>}
      {status === 'error' && (
        <ErrorBanner error={loadError} context="Failed to load access rules" />
      )}
      <ErrorBanner error={listError} context="Action failed" />

      {status === 'ready' && (
        <ResourceTable<AccessRuleView>
          columns={[
            { key: 'id', header: 'ID', render: (r) => r.id },
            { key: 'name', header: 'Name', render: (r) => r.name },
            { key: 'groups', header: 'Groups', render: (r) => r.groupIds.length },
            { key: 'zones', header: 'Time Zones', render: (r) => r.timeZoneIds.length },
            { key: 'portals', header: 'Portals', render: (r) => r.portalIds.length },
          ]}
          rows={rules}
          rowKey={(r) => r.id}
          onEdit={openEdit}
          onDelete={(r) => void remove(r)}
          emptyMessage="No access rules yet. Compose one from groups, time zones, and portals."
        />
      )}

      {form !== null && (
        <Modal
          title={form.id === null ? 'New access rule' : `Edit access rule #${String(form.id)}`}
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
            <MultiSelect
              label="Groups"
              options={groups.map((g) => ({ id: g.id, label: g.name }))}
              selected={form.groupIds}
              disabled={saving}
              onChange={(groupIds) => setForm({ ...form, groupIds })}
              emptyMessage="No groups yet. Create a group first."
            />
            <MultiSelect
              label="Time Zones"
              options={zones.map((z) => ({ id: z.id, label: z.name }))}
              selected={form.timeZoneIds}
              disabled={saving}
              onChange={(timeZoneIds) => setForm({ ...form, timeZoneIds })}
              emptyMessage="No time zones yet. Create a time zone first."
            />
            <MultiSelect
              label="Portals"
              options={portals.map((p) => ({ id: p.id, label: p.name }))}
              selected={form.portalIds}
              disabled={saving}
              onChange={(portalIds) => setForm({ ...form, portalIds })}
              emptyMessage="No portals yet. Create a portal first."
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
