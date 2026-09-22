import React, { useState, useEffect, useCallback } from 'react';
import { useFcgi } from '../hooks/useFcgi.ts';

interface TimeZoneRow {
  id: number;
  name: string;
}

interface TimeZoneItem extends TimeZoneRow {
  intervalCount: number;
}

interface LoadTimeZonesResponse {
  time_zones?: TimeZoneRow[];
}

interface TimeSpanRow {
  id: number;
  time_zone_id: number;
}

interface LoadTimeSpansResponse {
  time_spans?: TimeSpanRow[];
}

interface TimeZoneFormData {
  name: string;
}

const INITIAL_FORM_DATA: TimeZoneFormData = {
  name: '',
};

export function TimeZonesPage() {
  const { fcgiFetch } = useFcgi();

  const [timeZones, setTimeZones] = useState<TimeZoneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<TimeZoneFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  const [editingTimeZone, setEditingTimeZone] = useState<TimeZoneItem | null>(null);
  const [editFormData, setEditFormData] = useState<TimeZoneFormData>(INITIAL_FORM_DATA);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [deletingTimeZone, setDeletingTimeZone] = useState<TimeZoneItem | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const loadTimeZones = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [timeZonesData, spansData] = await Promise.all([
        fcgiFetch<LoadTimeZonesResponse>('/load_objects.fcgi?object=time_zones', {
          method: 'POST',
          body: JSON.stringify({ object: 'time_zones' }),
        }),
        fcgiFetch<LoadTimeSpansResponse>('/load_objects.fcgi?object=time_spans', {
          method: 'POST',
          body: JSON.stringify({ object: 'time_spans' }),
        }),
      ]);

      const intervalCounts = new Map<number, number>();
      for (const row of spansData.time_spans || []) {
        intervalCounts.set(row.time_zone_id, (intervalCounts.get(row.time_zone_id) ?? 0) + 1);
      }

      setTimeZones(
        (timeZonesData.time_zones || []).map((timeZone) => ({
          ...timeZone,
          intervalCount: intervalCounts.get(timeZone.id) ?? 0,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar horários');
    } finally {
      setLoading(false);
    }
  }, [fcgiFetch]);

  useEffect(() => {
    loadTimeZones();
  }, [loadTimeZones]);

  const closeCreateModal = () => {
    setShowModal(false);
    setFormData(INITIAL_FORM_DATA);
  };

  const handleCreateTimeZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name.trim().length === 0) {
      setError('O nome do horário é obrigatório');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);

      await fcgiFetch('/create_objects.fcgi?object=time_zones', {
        method: 'POST',
        body: JSON.stringify({
          object: 'time_zones',
          values: [{ name: formData.name }],
        }),
      });

      closeCreateModal();
      await loadTimeZones();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar horário');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (timeZone: TimeZoneItem) => {
    setEditingTimeZone(timeZone);
    setEditFormData({ name: timeZone.name });
    setError(null);
  };

  const handleEditTimeZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTimeZone) return;
    if (editFormData.name.trim().length === 0) {
      setError('O nome do horário é obrigatório');
      return;
    }
    try {
      setSubmittingEdit(true);
      setError(null);

      if (editFormData.name !== editingTimeZone.name) {
        await fcgiFetch('/modify_objects.fcgi?object=time_zones', {
          method: 'POST',
          body: JSON.stringify({
            object: 'time_zones',
            values: { name: editFormData.name },
            where: { id: editingTimeZone.id },
          }),
        });
      }

      setEditingTimeZone(null);
      setEditFormData(INITIAL_FORM_DATA);
      await loadTimeZones();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar horário');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeleteTimeZone = async () => {
    if (!deletingTimeZone) return;
    try {
      setSubmittingDelete(true);
      setError(null);
      await fcgiFetch('/destroy_objects.fcgi?object=time_zones', {
        method: 'POST',
        body: JSON.stringify({
          object: 'time_zones',
          where: { id: deletingTimeZone.id },
        }),
      });
      setDeletingTimeZone(null);
      await loadTimeZones();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir horário');
    } finally {
      setSubmittingDelete(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 aria-label="Time Zones" className="text-2xl font-bold tracking-tight text-white">
            Horários
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Configure horários e seus intervalos para compor regras de acesso
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-400 transition-colors"
        >
          Novo Horário
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Time zone table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando horários...</div>
        ) : timeZones.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Nenhum horário cadastrado no momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-3.5 font-semibold">ID</th>
                  <th className="px-6 py-3.5 font-semibold">Nome</th>
                  <th className="px-6 py-3.5 font-semibold">Intervalos</th>
                  <th className="px-6 py-3.5 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {timeZones.map((timeZone) => (
                  <tr key={timeZone.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{timeZone.id}</td>
                    <td className="px-6 py-4 font-medium text-white">{timeZone.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-300">
                      {timeZone.intervalCount}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleOpenEdit(timeZone)}
                        aria-label={`Editar ${timeZone.name}`}
                        className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 rounded border border-sky-500/30 hover:bg-sky-500/10 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setDeletingTimeZone(timeZone)}
                        aria-label={`Excluir ${timeZone.name}`}
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

      {/* Modal create time zone */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Cadastrar Horário</h3>
              <button
                onClick={closeCreateModal}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTimeZone} className="space-y-4">
              <div>
                <label
                  htmlFor="timeZoneName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="timeZoneName"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Ex: Horário Comercial"
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

      {/* Modal edit time zone */}
      {editingTimeZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Editar Horário</h3>
              <button
                onClick={() => setEditingTimeZone(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditTimeZone} className="space-y-4">
              <div>
                <label
                  htmlFor="editTimeZoneName"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
                >
                  Nome
                </label>
                <input
                  id="editTimeZoneName"
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                  placeholder="Ex: Horário Comercial"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTimeZone(null)}
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

      {/* Modal confirm delete time zone */}
      {deletingTimeZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Confirmar Exclusão</h3>
              <button
                onClick={() => setDeletingTimeZone(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Tem certeza que deseja remover o horário{' '}
                <span className="font-semibold text-white">{deletingTimeZone.name}</span>?
              </p>
              <p className="text-xs text-rose-400 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                Esta ação removerá permanentemente o horário. Intervalos associados não são
                removidos automaticamente.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingTimeZone(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTimeZone}
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
