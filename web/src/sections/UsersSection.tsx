import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { adminGroups, adminUsers } from '../api/client.ts';
import type { AdminUserView, GroupView } from '../api/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { Modal } from '../components/Modal.tsx';
import { MultiSelect } from '../components/MultiSelect.tsx';
import { ResourceTable } from '../components/ResourceTable.tsx';

type LoadStatus = 'loading' | 'ready' | 'error';

interface FormState {
  id: number | null;
  registration: string;
  name: string;
  pin: string;
  groupIds: number[];
  hasPhoto: boolean;
}

/**
 * Users section (Req 2, 3): list/create/edit/delete Users with group membership
 * (multi-select), plus Facial_Photo upload/delete and an {@link Avatar} preview
 * served through `user_get_image.fcgi` (Req 3.4). Creating users here fills the
 * Simulate identity picker. 400/413 photo/field errors are surfaced inline
 * (Req 11.5) without clearing the form.
 */
export function UsersSection() {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [listError, setListError] = useState<unknown>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<unknown>(null);
  const [photoError, setPhotoError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Bumped after a photo upload/delete to bust the Avatar <img> cache.
  const [photoToken, setPhotoToken] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    try {
      const [userList, groupList] = await Promise.all([
        adminUsers.list(),
        adminGroups.list(),
      ]);
      setUsers(userList);
      setGroups(groupList);
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
    setForm({ id: null, registration: '', name: '', pin: '', groupIds: [], hasPhoto: false });
    setFormError(null);
    setPhotoError(null);
  };

  const openEdit = (user: AdminUserView): void => {
    setForm({
      id: user.id,
      registration: user.registration,
      name: user.name,
      pin: '',
      groupIds: [...user.groupIds],
      hasPhoto: user.hasPhoto,
    });
    setFormError(null);
    setPhotoError(null);
  };

  const closeForm = (): void => {
    setForm(null);
    setFormError(null);
    setPhotoError(null);
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
        registration: form.registration,
        name: form.name,
        groupIds: form.groupIds,
        ...(form.pin.length > 0 ? { pin: form.pin } : {}),
      };
      if (form.id === null) {
        await adminUsers.create(body);
      } else {
        await adminUsers.update(form.id, body);
      }
      closeForm();
      await load();
    } catch (error) {
      setFormError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: AdminUserView): Promise<void> => {
    setListError(null);
    try {
      await adminUsers.remove(user.id);
      await load();
    } catch (error) {
      setListError(error);
    }
  };

  /**
   * Upload the chosen file for the user in the open form (Req 3.1). Surfaces
   * 400 (bad mime) / 413 (too large) inline without disturbing the form
   * (Req 3.2, 3.3, 11.5).
   */
  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file later.
    event.target.value = '';
    if (file === undefined || form === null || form.id === null) {
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await adminUsers.uploadPhoto(form.id, file);
      setForm({ ...form, hasPhoto: true });
      setPhotoToken((t) => t + 1);
      await load();
    } catch (error) {
      setPhotoError(error);
    } finally {
      setPhotoBusy(false);
    }
  };

  const deletePhoto = async (): Promise<void> => {
    if (form === null || form.id === null) {
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await adminUsers.deletePhoto(form.id);
      setForm({ ...form, hasPhoto: false });
      setPhotoToken((t) => t + 1);
      await load();
    } catch (error) {
      setPhotoError(error);
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="users-title">
      <div className="section-header">
        <h2 className="card__title" id="users-title" style={{ margin: 0 }}>
          Users
        </h2>
        <button type="button" className="button" onClick={openCreate}>
          New user
        </button>
      </div>

      {status === 'loading' && <p className="alert alert--info">Loading users…</p>}
      {status === 'error' && <ErrorBanner error={loadError} context="Failed to load users" />}
      <ErrorBanner error={listError} context="Action failed" />

      {status === 'ready' && (
        <ResourceTable<AdminUserView>
          columns={[
            {
              key: 'avatar',
              header: '',
              render: (u) => (
                <Avatar userId={u.id} hasPhoto={u.hasPhoto} name={u.name} refreshToken={photoToken} />
              ),
            },
            { key: 'id', header: 'ID', render: (u) => u.id },
            { key: 'registration', header: 'Registration', render: (u) => u.registration },
            { key: 'name', header: 'Name', render: (u) => u.name },
            { key: 'groups', header: 'Groups', render: (u) => u.groupIds.length },
          ]}
          rows={users}
          rowKey={(u) => u.id}
          onEdit={openEdit}
          onDelete={(u) => void remove(u)}
          emptyMessage="No users yet. Create one — it becomes selectable in Simulate."
        />
      )}

      {form !== null && (
        <Modal
          title={form.id === null ? 'New user' : `Edit user #${String(form.id)}`}
          onClose={closeForm}
        >
          <form onSubmit={(e) => void submit(e)}>
            <ErrorBanner error={formError} context="Save failed" />
            <label className="field">
              <span className="field__label">Registration</span>
              <input
                className="select"
                type="text"
                value={form.registration}
                maxLength={64}
                disabled={saving}
                autoFocus
                onChange={(e) => setForm({ ...form, registration: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="select"
                type="text"
                value={form.name}
                maxLength={128}
                disabled={saving}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">PIN (optional)</span>
              <input
                className="select"
                type="text"
                value={form.pin}
                disabled={saving}
                placeholder={form.id === null ? '' : 'Leave blank to keep unchanged'}
                onChange={(e) => setForm({ ...form, pin: e.target.value })}
              />
            </label>
            <MultiSelect
              label="Groups"
              options={groups.map((g) => ({ id: g.id, label: g.name }))}
              selected={form.groupIds}
              disabled={saving}
              onChange={(groupIds) => setForm({ ...form, groupIds })}
              emptyMessage="No groups yet."
            />

            <div className="field">
              <span className="field__label">Facial photo</span>
              {form.id === null ? (
                <p className="empty-state empty-state--compact">
                  Save the user first, then reopen to upload a photo.
                </p>
              ) : (
                <div className="photo-editor">
                  <Avatar
                    userId={form.id}
                    hasPhoto={form.hasPhoto}
                    name={form.name}
                    refreshToken={photoToken}
                  />
                  <div className="button-row">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      style={{ display: 'none' }}
                      onChange={(e) => void uploadPhoto(e)}
                    />
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={photoBusy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {photoBusy ? 'Working…' : form.hasPhoto ? 'Replace photo' : 'Upload photo'}
                    </button>
                    {form.hasPhoto && (
                      <button
                        type="button"
                        className="button button--danger button--small"
                        disabled={photoBusy}
                        onClick={() => void deletePhoto()}
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                  <ErrorBanner error={photoError} context="Photo failed" />
                </div>
              )}
            </div>

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
