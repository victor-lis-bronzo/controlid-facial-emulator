import React, { useState, useEffect, useCallback } from 'react';
import { useFcgi } from '../hooks/useFcgi.ts';

interface AccessRuleRow {
  id: number;
  name: string;
}

interface LoadAccessRulesResponse {
  access_rules?: AccessRuleRow[];
}

interface AccessRuleFormData {
  name: string;
}

const INITIAL_FORM_DATA: AccessRuleFormData = {
  name: '',
};

export function AccessRulesPage() {
  const { fcgiFetch } = useFcgi();

  const [accessRules, setAccessRules] = useState<AccessRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<AccessRuleFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  const [editingAccessRule, setEditingAccessRule] = useState<AccessRuleRow | null>(null);
  const [editFormData, setEditFormData] = useState<AccessRuleFormData>(INITIAL_FORM_DATA);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [deletingAccessRule, setDeletingAccessRule] = useState<AccessRuleRow | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const loadAccessRules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const accessRulesData = await fcgiFetch<LoadAccessRulesResponse>(
        '/load_objects.fcgi?object=access_rules',
        {
          method: 'POST',
          body: JSON.stringify({ object: 'access_rules' }),
        }
      );
      setAccessRules(accessRulesData.access_rules || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar regras de acesso');
    } finally {
      setLoading(false);
    }
  }, [fcgiFetch]);

  useEffect(() => {
    loadAccessRules();
  }, [loadAccessRules]);

  const closeCreateModal = () => {
    setShowModal(false);
    setFormData(INITIAL_FORM_DATA);
  };

  const handleCreateAccessRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name.trim().length === 0) {
      setError('O nome da regra de acesso é obrigatório');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);

      await fcgiFetch('/create_objects.fcgi?object=access_rules', {
        method: 'POST',
        body: JSON.stringify({
          object: 'access_rules',
          values: [{ name: formData.name }],
        }),
      });

      closeCreateModal();
      await loadAccessRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar regra de acesso');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (accessRule: AccessRuleRow) => {
    setEditingAccessRule(accessRule);
    setEditFormData({ name: accessRule.name });
    setError(null);
  };

  const handleEditAccessRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccessRule) return;
    if (editFormData.name.trim().length === 0) {
      setError('O nome da regra de acesso é obrigatório');
      return;
    }
    try {
      setSubmittingEdit(true);
      setError(null);

      if (editFormData.name !== editingAccessRule.name) {
        await fcgiFetch('/modify_objects.fcgi?object=access_rules', {
          method: 'POST',
          body: JSON.stringify({
            object: 'access_rules',
            values: { name: editFormData.name },
            where: { id: editingAccessRule.id },
          }),
        });
      }

      setEditingAccessRule(null);
      setEditFormData(INITIAL_FORM_DATA);
      await loadAccessRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar regra de acesso');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeleteAccessRule = async () => {
    if (!deletingAccessRule) return;
    try {
      setSubmittingDelete(true);
      setError(null);
      await fcgiFetch('/destroy_objects.fcgi?object=access_rules', {
        method: 'POST',
        body: JSON.stringify({
          object: 'access_rules',
          where: { id: deletingAccessRule.id },
        }),
      });
      setDeletingAccessRule(null);
      await loadAccessRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir regra de acesso');
    } finally {
      setSubmittingDelete(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 aria-label="Access Rules" className="text-2xl font-bold tracking-tight text-white">
            Regras de Acesso
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Configure regras de acesso combinando grupos, horários e portais
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-400 transition-colors"
        >
          Nova Regra
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Access rule table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando regras de acesso...</div>
        ) : accessRules.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Nenhuma regra de acesso cadastrada no momento.
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
                {accessRules.map((accessRule) => (
                  <tr key={accessRule.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{accessRule.id}</td>
                    <td className="px-6 py-4 font-medium text-white">{accessRule.name}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleOpenEdit(accessRule)}
                        aria-label={`Editar ${accessRule.name}`}
                        className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 rounded border border-sky-500/30 hover:bg-sky-500/10 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setDeletingAccessRule(accessRule)}
                        aria-label={`Excluir ${accessRule.name}`}
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

      {/* Modal create access rule */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Cadastrar Regra de Acesso</h3>
              <button
                onClick={closeCreateModal}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAccessRule} className="space-y-4">
              <div>
                <label
                  htmlFor="accessRuleName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="accessRuleName"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Ex: Acesso Administrativo"
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

      {/* Modal edit access rule */}
      {editingAccessRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Editar Regra de Acesso</h3>
              <button
                onClick={() => setEditingAccessRule(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditAccessRule} className="space-y-4">
              <div>
                <label
                  htmlFor="editAccessRuleName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="editAccessRuleName"
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                  placeholder="Ex: Acesso Administrativo"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingAccessRule(null)}
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

      {/* Modal confirm delete access rule */}
      {deletingAccessRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Confirmar Exclusão</h3>
              <button
                onClick={() => setDeletingAccessRule(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Tem certeza que deseja remover a regra de acesso{' '}
                <span className="font-semibold text-white">{deletingAccessRule.name}</span>?
              </p>
              <p className="text-xs text-rose-400 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                Esta ação removerá permanentemente a regra e suas associações de grupos, horários
                e portais.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingAccessRule(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccessRule}
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
