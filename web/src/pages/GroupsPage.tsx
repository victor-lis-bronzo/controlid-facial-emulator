import React, { useState, useEffect, useCallback } from 'react';
import { useFcgi } from '../hooks/useFcgi.ts';

interface GroupRow {
  id: number;
  name: string;
}

interface GroupItem extends GroupRow {
  memberCount: number;
}

interface LoadGroupsResponse {
  groups?: GroupRow[];
}

interface UserGroupRow {
  user_id: number;
  group_id: number;
}

interface LoadUserGroupsResponse {
  user_groups?: UserGroupRow[];
}

interface GroupFormData {
  name: string;
}

const INITIAL_FORM_DATA: GroupFormData = {
  name: '',
};

export function GroupsPage() {
  const { fcgiFetch } = useFcgi();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<GroupFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  const [editingGroup, setEditingGroup] = useState<GroupItem | null>(null);
  const [editFormData, setEditFormData] = useState<GroupFormData>(INITIAL_FORM_DATA);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [deletingGroup, setDeletingGroup] = useState<GroupItem | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [groupsData, membershipData] = await Promise.all([
        fcgiFetch<LoadGroupsResponse>('/load_objects.fcgi?object=groups', {
          method: 'POST',
          body: JSON.stringify({ object: 'groups' }),
        }),
        fcgiFetch<LoadUserGroupsResponse>('/load_objects.fcgi?object=user_groups', {
          method: 'POST',
          body: JSON.stringify({ object: 'user_groups' }),
        }),
      ]);

      const memberCounts = new Map<number, number>();
      for (const row of membershipData.user_groups || []) {
        memberCounts.set(row.group_id, (memberCounts.get(row.group_id) ?? 0) + 1);
      }

      setGroups(
        (groupsData.groups || []).map((group) => ({
          ...group,
          memberCount: memberCounts.get(group.id) ?? 0,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar grupos');
    } finally {
      setLoading(false);
    }
  }, [fcgiFetch]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const closeCreateModal = () => {
    setShowModal(false);
    setFormData(INITIAL_FORM_DATA);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name.trim().length === 0) {
      setError('O nome do grupo é obrigatório');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);

      await fcgiFetch('/create_objects.fcgi?object=groups', {
        method: 'POST',
        body: JSON.stringify({
          object: 'groups',
          values: [{ name: formData.name }],
        }),
      });

      closeCreateModal();
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar grupo');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (group: GroupItem) => {
    setEditingGroup(group);
    setEditFormData({ name: group.name });
  };

  const handleEditGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup) return;
    if (editFormData.name.trim().length === 0) {
      setError('O nome do grupo é obrigatório');
      return;
    }
    try {
      setSubmittingEdit(true);
      setError(null);

      if (editFormData.name !== editingGroup.name) {
        await fcgiFetch('/modify_objects.fcgi?object=groups', {
          method: 'POST',
          body: JSON.stringify({
            object: 'groups',
            values: { name: editFormData.name },
            where: { id: editingGroup.id },
          }),
        });
      }

      setEditingGroup(null);
      setEditFormData(INITIAL_FORM_DATA);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar grupo');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deletingGroup) return;
    try {
      setSubmittingDelete(true);
      setError(null);
      await fcgiFetch('/destroy_objects.fcgi?object=groups', {
        method: 'POST',
        body: JSON.stringify({
          object: 'groups',
          where: { id: deletingGroup.id },
        }),
      });
      setDeletingGroup(null);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir grupo');
    } finally {
      setSubmittingDelete(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 aria-label="Groups" className="text-2xl font-bold tracking-tight text-white">
            Grupos
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Organize usuários em grupos para compor regras de acesso
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-400 transition-colors"
        >
          Novo Grupo
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Group table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando grupos...</div>
        ) : groups.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Nenhum grupo cadastrado no momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-3.5 font-semibold">ID</th>
                  <th className="px-6 py-3.5 font-semibold">Nome</th>
                  <th className="px-6 py-3.5 font-semibold">Membros</th>
                  <th className="px-6 py-3.5 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {groups.map((group) => (
                  <tr key={group.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{group.id}</td>
                    <td className="px-6 py-4 font-medium text-white">{group.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-300">
                      {group.memberCount}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleOpenEdit(group)}
                        aria-label={`Editar ${group.name}`}
                        className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 rounded border border-sky-500/30 hover:bg-sky-500/10 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setDeletingGroup(group)}
                        aria-label={`Excluir ${group.name}`}
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

      {/* Modal create group */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Cadastrar Grupo</h3>
              <button
                onClick={closeCreateModal}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label
                  htmlFor="groupName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="groupName"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Ex: Administradores"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

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

      {/* Modal edit group */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Editar Grupo</h3>
              <button
                onClick={() => setEditingGroup(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditGroup} className="space-y-4">
              <div>
                <label
                  htmlFor="editGroupName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="editGroupName"
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                  placeholder="Ex: Administradores"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingGroup(null)}
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

      {/* Modal confirm delete group */}
      {deletingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Confirmar Exclusão</h3>
              <button
                onClick={() => setDeletingGroup(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Tem certeza que deseja remover o grupo{' '}
                <span className="font-semibold text-white">{deletingGroup.name}</span>?
              </p>
              <p className="text-xs text-rose-400 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                Esta ação removerá permanentemente o grupo e suas associações de membros.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingGroup(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteGroup}
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
