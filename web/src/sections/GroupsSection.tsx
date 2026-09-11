import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { adminGroups, adminUsers } from '../api/client.ts';
import type { AdminUserView, GroupDetail, GroupView } from '../api/types.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { Modal } from '../components/Modal.tsx';
import { MultiSelect } from '../components/MultiSelect.tsx';
import { ResourceTable } from '../components/ResourceTable.tsx';

type LoadStatus = 'loading' | 'ready' | 'error';

interface FormState {
  id: number | null;
  name: string;
  memberIds: number[];
}

/**
 * Groups section (Req 4): list with member count, create/edit with a member
 * picker (multi-select of Users), and delete. A referenced-delete surfaces the
 * server's 409 message (Req 7.7) via {@link ErrorBanner} without clearing the
 * form (Req 11.5).
 */
export function GroupsSection() {
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [users, setUsers] = useState<AdminUserView[]>([]);
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
      const [groupList, userList] = await Promise.all([
        adminGroups.list(),
        adminUsers.list(),
      ]);
      setGroups(groupList);
      setUsers(userList);
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
    setForm({ id: null, name: '', memberIds: [] });
    setFormError(null);
  };

  const openEdit = async (group: GroupView): Promise<void> => {
    setListError(null);
    try {
      const detail: GroupDetail = await adminGroups.get(group.id);
      setForm({
        id: detail.id,
        name: detail.name,
        memberIds: detail.members.map((m) => m.id),
      });
      setFormError(null);
    } catch (error) {
      setListError(error);
    }
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
      const body = { name: form.name, memberIds: form.memberIds };
      if (form.id === null) {
        await adminGroups.create(body);
      } else {
        await adminGroups.update(form.id, body);
      }
      closeForm();
      await load();
    } catch (error) {
      setFormError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (group: GroupView): Promise<void> => {
    setListError(null);
    try {
      await adminGroups.remove(group.id);
      await load();
    } catch (error) {
      // A 409 message names the referencing Access Rules (Req 7.7).
      setListError(error);
    }
  };

  return (
    <section className="card" aria-labelledby="groups-title">
      <div className="section-header">
        <h2 className="card__title" id="groups-title" style={{ margin: 0 }}>
          Groups
        </h2>
        <button type="button" className="button" onClick={openCreate}>
          New group
        </button>
      </div>

      {status === 'loading' && <p className="alert alert--info">Loading groups…</p>}
      {status === 'error' && <ErrorBanner error={loadError} context="Failed to load groups" />}
      <ErrorBanner error={listError} context="Action failed" />

      {status === 'ready' && (
        <ResourceTable<GroupView>
          columns={[
            { key: 'id', header: 'ID', render: (g) => g.id },
            { key: 'name', header: 'Name', render: (g) => g.name },
            { key: 'members', header: 'Members', render: (g) => g.memberCount },
          ]}
          rows={groups}
          rowKey={(g) => g.id}
          onEdit={(g) => void openEdit(g)}
          onDelete={(g) => void remove(g)}
          emptyMessage="No groups yet. Create one to organize users."
        />
      )}

      {form !== null && (
        <Modal
          title={form.id === null ? 'New group' : `Edit group #${String(form.id)}`}
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
              label="Members"
              options={users.map((u) => ({ id: u.id, label: `${u.name} (#${u.registration})` }))}
              selected={form.memberIds}
              disabled={saving}
              onChange={(memberIds) => setForm({ ...form, memberIds })}
              emptyMessage="No users yet. Create users first to add members."
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
