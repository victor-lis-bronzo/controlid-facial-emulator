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

interface NamedEntityRow {
  id: number;
  name: string;
}

interface LoadNamedEntityResponse {
  groups?: NamedEntityRow[];
  time_zones?: NamedEntityRow[];
  portals?: NamedEntityRow[];
}

interface GroupAccessRuleRow {
  group_id: number;
  access_rule_id: number;
}

interface AccessRuleTimeZoneRow {
  access_rule_id: number;
  time_zone_id: number;
}

interface PortalAccessRuleRow {
  portal_id: number;
  access_rule_id: number;
}

interface LoadGroupAccessRulesResponse {
  group_access_rules?: GroupAccessRuleRow[];
}

interface LoadAccessRuleTimeZonesResponse {
  access_rule_time_zones?: AccessRuleTimeZoneRow[];
}

interface LoadPortalAccessRulesResponse {
  portal_access_rules?: PortalAccessRuleRow[];
}

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

  const [loadingAssociations, setLoadingAssociations] = useState(false);
  const [allGroups, setAllGroups] = useState<NamedEntityRow[]>([]);
  const [allTimeZones, setAllTimeZones] = useState<NamedEntityRow[]>([]);
  const [allPortals, setAllPortals] = useState<NamedEntityRow[]>([]);
  const [originalGroupIds, setOriginalGroupIds] = useState<Set<number>>(new Set());
  const [checkedGroupIds, setCheckedGroupIds] = useState<Set<number>>(new Set());
  const [originalTimeZoneIds, setOriginalTimeZoneIds] = useState<Set<number>>(new Set());
  const [checkedTimeZoneIds, setCheckedTimeZoneIds] = useState<Set<number>>(new Set());
  const [originalPortalIds, setOriginalPortalIds] = useState<Set<number>>(new Set());
  const [checkedPortalIds, setCheckedPortalIds] = useState<Set<number>>(new Set());

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

  const handleOpenEdit = async (accessRule: AccessRuleRow) => {
    setEditingAccessRule(accessRule);
    setEditFormData({ name: accessRule.name });
    setError(null);
    setLoadingAssociations(true);
    try {
      const [groupsData, timeZonesData, portalsData, groupRulesData, timeZoneRulesData, portalRulesData] =
        await Promise.all([
          fcgiFetch<LoadNamedEntityResponse>('/load_objects.fcgi?object=groups', {
            method: 'POST',
            body: JSON.stringify({ object: 'groups' }),
          }),
          fcgiFetch<LoadNamedEntityResponse>('/load_objects.fcgi?object=time_zones', {
            method: 'POST',
            body: JSON.stringify({ object: 'time_zones' }),
          }),
          fcgiFetch<LoadNamedEntityResponse>('/load_objects.fcgi?object=portals', {
            method: 'POST',
            body: JSON.stringify({ object: 'portals' }),
          }),
          fcgiFetch<LoadGroupAccessRulesResponse>('/load_objects.fcgi?object=group_access_rules', {
            method: 'POST',
            body: JSON.stringify({
              object: 'group_access_rules',
              where: { access_rule_id: accessRule.id },
            }),
          }),
          fcgiFetch<LoadAccessRuleTimeZonesResponse>(
            '/load_objects.fcgi?object=access_rule_time_zones',
            {
              method: 'POST',
              body: JSON.stringify({
                object: 'access_rule_time_zones',
                where: { access_rule_id: accessRule.id },
              }),
            }
          ),
          fcgiFetch<LoadPortalAccessRulesResponse>('/load_objects.fcgi?object=portal_access_rules', {
            method: 'POST',
            body: JSON.stringify({
              object: 'portal_access_rules',
              where: { access_rule_id: accessRule.id },
            }),
          }),
        ]);

      setAllGroups(groupsData.groups || []);
      setAllTimeZones(timeZonesData.time_zones || []);
      setAllPortals(portalsData.portals || []);

      const groupIds = new Set((groupRulesData.group_access_rules || []).map((row) => row.group_id));
      setOriginalGroupIds(groupIds);
      setCheckedGroupIds(new Set(groupIds));

      const timeZoneIds = new Set(
        (timeZoneRulesData.access_rule_time_zones || []).map((row) => row.time_zone_id)
      );
      setOriginalTimeZoneIds(timeZoneIds);
      setCheckedTimeZoneIds(new Set(timeZoneIds));

      const portalIds = new Set(
        (portalRulesData.portal_access_rules || []).map((row) => row.portal_id)
      );
      setOriginalPortalIds(portalIds);
      setCheckedPortalIds(new Set(portalIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar associações da regra de acesso');
    } finally {
      setLoadingAssociations(false);
    }
  };

  const closeEditModal = () => {
    setEditingAccessRule(null);
    setEditFormData(INITIAL_FORM_DATA);
    setAllGroups([]);
    setAllTimeZones([]);
    setAllPortals([]);
    setOriginalGroupIds(new Set());
    setCheckedGroupIds(new Set());
    setOriginalTimeZoneIds(new Set());
    setCheckedTimeZoneIds(new Set());
    setOriginalPortalIds(new Set());
    setCheckedPortalIds(new Set());
  };

  const toggleGroup = (id: number) => {
    setCheckedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTimeZone = (id: number) => {
    setCheckedTimeZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePortal = (id: number) => {
    setCheckedPortalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEditAccessRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccessRule) return;
    if (editFormData.name.trim().length === 0) {
      setError('O nome da regra de acesso é obrigatório');
      return;
    }
    if (checkedGroupIds.size === 0) {
      setError('Selecione ao menos um grupo');
      return;
    }
    if (checkedTimeZoneIds.size === 0) {
      setError('Selecione ao menos um horário');
      return;
    }
    if (checkedPortalIds.size === 0) {
      setError('Selecione ao menos um portal');
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

      const ruleId = editingAccessRule.id;

      const groupsToAdd = [...checkedGroupIds].filter((id) => !originalGroupIds.has(id));
      const groupsToRemove = [...originalGroupIds].filter((id) => !checkedGroupIds.has(id));
      const timeZonesToAdd = [...checkedTimeZoneIds].filter((id) => !originalTimeZoneIds.has(id));
      const timeZonesToRemove = [...originalTimeZoneIds].filter((id) => !checkedTimeZoneIds.has(id));
      const portalsToAdd = [...checkedPortalIds].filter((id) => !originalPortalIds.has(id));
      const portalsToRemove = [...originalPortalIds].filter((id) => !checkedPortalIds.has(id));

      await Promise.all([
        ...groupsToAdd.map((groupId) =>
          fcgiFetch('/create_objects.fcgi?object=group_access_rules', {
            method: 'POST',
            body: JSON.stringify({
              object: 'group_access_rules',
              values: [{ group_id: groupId, access_rule_id: ruleId }],
            }),
          })
        ),
        ...groupsToRemove.map((groupId) =>
          fcgiFetch('/destroy_objects.fcgi?object=group_access_rules', {
            method: 'POST',
            body: JSON.stringify({
              object: 'group_access_rules',
              where: { group_id: groupId, access_rule_id: ruleId },
            }),
          })
        ),
        ...timeZonesToAdd.map((timeZoneId) =>
          fcgiFetch('/create_objects.fcgi?object=access_rule_time_zones', {
            method: 'POST',
            body: JSON.stringify({
              object: 'access_rule_time_zones',
              values: [{ access_rule_id: ruleId, time_zone_id: timeZoneId }],
            }),
          })
        ),
        ...timeZonesToRemove.map((timeZoneId) =>
          fcgiFetch('/destroy_objects.fcgi?object=access_rule_time_zones', {
            method: 'POST',
            body: JSON.stringify({
              object: 'access_rule_time_zones',
              where: { access_rule_id: ruleId, time_zone_id: timeZoneId },
            }),
          })
        ),
        ...portalsToAdd.map((portalId) =>
          fcgiFetch('/create_objects.fcgi?object=portal_access_rules', {
            method: 'POST',
            body: JSON.stringify({
              object: 'portal_access_rules',
              values: [{ portal_id: portalId, access_rule_id: ruleId }],
            }),
          })
        ),
        ...portalsToRemove.map((portalId) =>
          fcgiFetch('/destroy_objects.fcgi?object=portal_access_rules', {
            method: 'POST',
            body: JSON.stringify({
              object: 'portal_access_rules',
              where: { portal_id: portalId, access_rule_id: ruleId },
            }),
          })
        ),
      ]);

      closeEditModal();
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
          <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Editar Regra de Acesso</h3>
              <button onClick={closeEditModal} className="text-slate-400 hover:text-white text-sm">
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

              {loadingAssociations ? (
                <p className="text-xs text-slate-400 p-2">Carregando associações...</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                      Grupos
                    </span>
                    {allGroups.length === 0 ? (
                      <p className="text-xs text-slate-400 p-2">Nenhum grupo cadastrado.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-2 space-y-1">
                        {allGroups.map((group) => (
                          <label
                            key={group.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50 text-sm text-slate-200 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checkedGroupIds.has(group.id)}
                              onChange={() => toggleGroup(group.id)}
                              className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
                            />
                            {group.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                      Horários
                    </span>
                    {allTimeZones.length === 0 ? (
                      <p className="text-xs text-slate-400 p-2">Nenhum horário cadastrado.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-2 space-y-1">
                        {allTimeZones.map((timeZone) => (
                          <label
                            key={timeZone.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50 text-sm text-slate-200 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checkedTimeZoneIds.has(timeZone.id)}
                              onChange={() => toggleTimeZone(timeZone.id)}
                              className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
                            />
                            {timeZone.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                      Portais
                    </span>
                    {allPortals.length === 0 ? (
                      <p className="text-xs text-slate-400 p-2">Nenhum portal cadastrado.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-2 space-y-1">
                        {allPortals.map((portal) => (
                          <label
                            key={portal.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50 text-sm text-slate-200 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checkedPortalIds.has(portal.id)}
                              onChange={() => togglePortal(portal.id)}
                              className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
                            />
                            {portal.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEditModal}
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
