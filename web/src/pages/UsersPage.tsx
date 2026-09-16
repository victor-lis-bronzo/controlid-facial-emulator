import React, { useState, useEffect, useCallback } from 'react';
import { useFcgi } from '../hooks/useFcgi.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { PhotoField } from '../components/PhotoField.tsx';

interface UserItem {
  id: number;
  name: string;
  registration: string;
  image_path: string | null;
}

interface LoadUsersResponse {
  users?: UserItem[];
}

interface UserFormData {
  name: string;
  registration: string;
  password: string;
}

const INITIAL_FORM_DATA: UserFormData = {
  name: '',
  registration: '',
  password: '',
};

export function UsersPage() {
  const { fcgiFetch, fcgiUpload } = useFcgi();
  const { session } = useAuth();

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<UserFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editFormData, setEditFormData] = useState<UserFormData>(INITIAL_FORM_DATA);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [deletingUser, setDeletingUser] = useState<UserItem | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const [photoRefreshTokens, setPhotoRefreshTokens] = useState<Record<number, number>>({});
  const [stagedPhotoFile, setStagedPhotoFile] = useState<File | null>(null);
  const [editPhotoInitialError, setEditPhotoInitialError] = useState<string | null>(null);

  const closeCreateModal = () => {
    setShowModal(false);
    setStagedPhotoFile(null);
  };

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fcgiFetch<LoadUsersResponse>('/load_objects.fcgi?object=users', {
        method: 'POST',
        body: JSON.stringify({ object: 'users' }),
      });
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }, [fcgiFetch]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      const userPayload: Record<string, unknown> = {
        name: formData.name,
        registration: formData.registration,
      };

      if (formData.password.trim().length > 0) {
        userPayload.password = formData.password;
      }

      const created = await fcgiFetch<{ ids: number[] }>('/create_objects.fcgi?object=users', {
        method: 'POST',
        body: JSON.stringify({
          object: 'users',
          values: [userPayload],
        }),
      });

      const newUserId = created.ids[0];
      // `ids` should always be non-empty on success, but guard against an
      // unexpected empty array so we never send `user_id: undefined` to
      // user_set_image.fcgi: treat it exactly like "no staged photo".
      const photoToUpload = newUserId !== undefined ? stagedPhotoFile : null;

      setFormData(INITIAL_FORM_DATA);
      setStagedPhotoFile(null);
      setShowModal(false);

      if (photoToUpload) {
        // The user was already created successfully at this point. A
        // failure here is a partial failure (Issue #40): it must not be
        // treated as a creation failure, must not roll back the created
        // user, and should surface by reopening the edit modal for this
        // user with the upload error already visible.
        try {
          const body = new FormData();
          body.append('user_id', String(newUserId));
          body.append('file', photoToUpload);
          await fcgiUpload('/user_set_image.fcgi', body);
          await loadUsers();
        } catch (photoErr) {
          await loadUsers();
          const message =
            photoErr instanceof Error ? photoErr.message : 'Erro ao enviar foto';
          openEditModal(
            {
              id: newUserId as number,
              name: userPayload.name as string,
              registration: userPayload.registration as string,
              image_path: null,
            },
            message
          );
        }
      } else {
        await loadUsers();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar usuário');
    } finally {
      setSubmitting(false);
    }
  };

  // Shared by manual "Editar" clicks and the Issue #40 partial-failure
  // recovery path, so both build the same editingUser/editFormData shape.
  const openEditModal = (user: UserItem, photoError: string | null = null) => {
    setEditPhotoInitialError(photoError);
    setEditingUser(user);
    setEditFormData({
      name: user.name,
      registration: user.registration,
      password: '',
    });
  };

  const handleOpenEdit = (user: UserItem) => {
    openEditModal(user);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      setSubmittingEdit(true);
      setError(null);

      const userPayload: Record<string, unknown> = {
        name: editFormData.name,
        registration: editFormData.registration,
      };

      if (editFormData.password.trim().length > 0) {
        userPayload.password = editFormData.password;
      }

      await fcgiFetch('/modify_objects.fcgi?object=users', {
        method: 'POST',
        body: JSON.stringify({
          object: 'users',
          values: userPayload,
          where: { id: editingUser.id },
        }),
      });

      setEditingUser(null);
      setEditFormData(INITIAL_FORM_DATA);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar usuário');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handlePhotoUpdated = async (hasPhoto: boolean) => {
    if (!editingUser) return;
    const userId = editingUser.id;
    setPhotoRefreshTokens((prev) => ({ ...prev, [userId]: Date.now() }));
    setEditingUser((prev) => (prev ? { ...prev, image_path: hasPhoto ? 'photo' : null } : prev));
    await loadUsers();
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    try {
      setSubmittingDelete(true);
      setError(null);
      await fcgiFetch('/destroy_objects.fcgi?object=users', {
        method: 'POST',
        body: JSON.stringify({
          object: 'users',
          where: { id: deletingUser.id },
        }),
      });
      setDeletingUser(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir usuário');
    } finally {
      setSubmittingDelete(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 aria-label="Users" className="text-2xl font-bold tracking-tight text-white">
              Usuários
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Gerencie as pessoas cadastradas na leitora facial
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-400 transition-colors"
          >
            Novo Usuário
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* User table */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-400">Carregando usuários...</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              Nenhum usuário cadastrado no momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/50 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-6 py-3.5 font-semibold">Foto</th>
                    <th className="px-6 py-3.5 font-semibold">ID</th>
                    <th className="px-6 py-3.5 font-semibold">Nome</th>
                    <th className="px-6 py-3.5 font-semibold">Matrícula</th>
                    <th className="px-6 py-3.5 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-4">
                        <Avatar
                          userId={user.id}
                          hasPhoto={Boolean(user.image_path)}
                          name={user.name}
                          refreshToken={photoRefreshTokens[user.id]}
                          session={session ?? undefined}
                        />
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">{user.id}</td>
                      <td className="px-6 py-4 font-medium text-white">{user.name}</td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-300">
                        {user.registration || '-'}
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => handleOpenEdit(user)}
                          aria-label={`Editar ${user.name}`}
                          className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 rounded border border-sky-500/30 hover:bg-sky-500/10 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => setDeletingUser(user)}
                          aria-label={`Excluir ${user.name}`}
                          className="text-xs font-semibold text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded border border-rose-500/30 hover:bg-rose-500/10 transition-colors"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* Modal create user */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Cadastrar Usuário</h3>
              <button
                onClick={closeCreateModal}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label
                  htmlFor="userName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="userName"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Nome completo"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="userRegistration"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Matrícula
                </label>
                <input
                  id="userRegistration"
                  type="text"
                  value={formData.registration}
                  onChange={(e) => setFormData({ ...formData, registration: e.target.value })}
                  required
                  placeholder="Ex: 12345"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="userPassword"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Senha
                </label>
                <input
                  id="userPassword"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="PIN numérico"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <PhotoField
                mode="staged"
                hasPhoto={false}
                name={formData.name || 'Novo usuário'}
                inputId="newUserPhoto"
                onFileStaged={setStagedPhotoFile}
              />

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal edit user */}
      {/* Conditionally rendered (not `hidden`) so PhotoField unmounts/remounts
          on every editingUser change — PhotoField's `initialError` prop is
          only read once, at mount, so this remount is what makes the
          Issue #40 auto-reopen-with-error flow work. */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Editar Usuário</h3>
              <button
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditUser} className="space-y-4">
              <div>
                <label
                  htmlFor="editUserName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="editUserName"
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                  placeholder="Nome completo"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="editUserRegistration"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Matrícula
                </label>
                <input
                  id="editUserRegistration"
                  type="text"
                  value={editFormData.registration}
                  onChange={(e) => setEditFormData({ ...editFormData, registration: e.target.value })}
                  required
                  placeholder="Ex: 12345"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="editUserPassword"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Senha / PIN
                </label>
                <input
                  id="editUserPassword"
                  type="password"
                  value={editFormData.password}
                  onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                  placeholder="Deixe em branco para manter a atual"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <PhotoField
                userId={editingUser.id}
                hasPhoto={Boolean(editingUser.image_path)}
                name={editingUser.name}
                refreshToken={photoRefreshTokens[editingUser.id]}
                session={session ?? undefined}
                onPhotoUpdated={handlePhotoUpdated}
                initialError={editPhotoInitialError}
              />

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
                >
                  {submittingEdit ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirm delete user */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Confirmar Exclusão</h3>
              <button
                onClick={() => setDeletingUser(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Tem certeza que deseja remover o usuário{' '}
                <span className="font-semibold text-white">{deletingUser.name}</span>{' '}
                (Matrícula:{' '}
                <span className="font-mono text-white">{deletingUser.registration || '-'}</span>)?
              </p>
              <p className="text-xs text-rose-400 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                Esta ação removerá permanentemente o usuário, sua biometria facial e permissões associadas.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingUser(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteUser}
                  disabled={submittingDelete}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
                >
                  {submittingDelete ? 'Excluindo...' : 'Confirmar Exclusão'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
