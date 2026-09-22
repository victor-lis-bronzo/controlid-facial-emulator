import React, { useState, useEffect, useCallback } from 'react';
import { useFcgi } from '../hooks/useFcgi.ts';

interface PortalRow {
  id: number;
  name: string;
}

interface LoadPortalsResponse {
  portals?: PortalRow[];
}

interface PortalFormData {
  name: string;
}

const INITIAL_FORM_DATA: PortalFormData = {
  name: '',
};

export function PortalsPage() {
  const { fcgiFetch } = useFcgi();

  const [portals, setPortals] = useState<PortalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<PortalFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  const [editingPortal, setEditingPortal] = useState<PortalRow | null>(null);
  const [editFormData, setEditFormData] = useState<PortalFormData>(INITIAL_FORM_DATA);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [deletingPortal, setDeletingPortal] = useState<PortalRow | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const loadPortals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const portalsData = await fcgiFetch<LoadPortalsResponse>('/load_objects.fcgi?object=portals', {
        method: 'POST',
        body: JSON.stringify({ object: 'portals' }),
      });
      setPortals(portalsData.portals || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar portais');
    } finally {
      setLoading(false);
    }
  }, [fcgiFetch]);

  useEffect(() => {
    loadPortals();
  }, [loadPortals]);

  const closeCreateModal = () => {
    setShowModal(false);
    setFormData(INITIAL_FORM_DATA);
  };

  const handleCreatePortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name.trim().length === 0) {
      setError('O nome do portal é obrigatório');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);

      await fcgiFetch('/create_objects.fcgi?object=portals', {
        method: 'POST',
        body: JSON.stringify({
          object: 'portals',
          values: [{ name: formData.name }],
        }),
      });

      closeCreateModal();
      await loadPortals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar portal');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (portal: PortalRow) => {
    setEditingPortal(portal);
    setEditFormData({ name: portal.name });
    setError(null);
  };

  const handleEditPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPortal) return;
    if (editFormData.name.trim().length === 0) {
      setError('O nome do portal é obrigatório');
      return;
    }
    try {
      setSubmittingEdit(true);
      setError(null);

      if (editFormData.name !== editingPortal.name) {
        await fcgiFetch('/modify_objects.fcgi?object=portals', {
          method: 'POST',
          body: JSON.stringify({
            object: 'portals',
            values: { name: editFormData.name },
            where: { id: editingPortal.id },
          }),
        });
      }

      setEditingPortal(null);
      setEditFormData(INITIAL_FORM_DATA);
      await loadPortals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar portal');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeletePortal = async () => {
    if (!deletingPortal) return;
    try {
      setSubmittingDelete(true);
      setError(null);
      await fcgiFetch('/destroy_objects.fcgi?object=portals', {
        method: 'POST',
        body: JSON.stringify({
          object: 'portals',
          where: { id: deletingPortal.id },
        }),
      });
      setDeletingPortal(null);
      await loadPortals();
    } catch (err) {
      // A portal still referenced by an access rule (portal_access_rules)
      // returns a 400 naming the conflict — surface it instead of closing
      // the modal, so the admin understands why the delete didn't go through.
      setError(err instanceof Error ? err.message : 'Erro ao excluir portal');
    } finally {
      setSubmittingDelete(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 aria-label="Portals" className="text-2xl font-bold tracking-tight text-white">
            Portais
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Cadastre os portais (portas) controlados pela leitora
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-400 transition-colors"
        >
          Novo Portal
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Portal table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando portais...</div>
        ) : portals.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Nenhum portal cadastrado no momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-3.5 font-semibold">ID</th>
                  <th className="px-6 py-3.5 font-semibold">Nome</th>
                  <th className="px-6 py-3.5 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {portals.map((portal) => (
                  <tr key={portal.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{portal.id}</td>
                    <td className="px-6 py-4 font-medium text-white">{portal.name}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleOpenEdit(portal)}
                        aria-label={`Editar ${portal.name}`}
                        className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 rounded border border-sky-500/30 hover:bg-sky-500/10 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setDeletingPortal(portal)}
                        aria-label={`Excluir ${portal.name}`}
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

      {/* Modal create portal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Cadastrar Portal</h3>
              <button
                onClick={closeCreateModal}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePortal} className="space-y-4">
              <div>
                <label
                  htmlFor="portalName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="portalName"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Ex: Porta Principal"
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

      {/* Modal edit portal */}
      {editingPortal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Editar Portal</h3>
              <button
                onClick={() => setEditingPortal(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditPortal} className="space-y-4">
              <div>
                <label
                  htmlFor="editPortalName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="editPortalName"
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                  placeholder="Ex: Porta Principal"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPortal(null)}
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

      {/* Modal confirm delete portal */}
      {deletingPortal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Confirmar Exclusão</h3>
              <button
                onClick={() => setDeletingPortal(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Tem certeza que deseja remover o portal{' '}
                <span className="font-semibold text-white">{deletingPortal.name}</span>?
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingPortal(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeletePortal}
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
