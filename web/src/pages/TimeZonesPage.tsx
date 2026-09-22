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
  start: string;
  end: string;
  sun: string;
  mon: string;
  tue: string;
  wed: string;
  thu: string;
  fri: string;
  sat: string;
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

const WEEKDAYS = [
  { key: 'sun', label: 'Dom' },
  { key: 'mon', label: 'Seg' },
  { key: 'tue', label: 'Ter' },
  { key: 'wed', label: 'Qua' },
  { key: 'thu', label: 'Qui' },
  { key: 'fri', label: 'Sex' },
  { key: 'sat', label: 'Sáb' },
] as const;

type WeekdayKey = (typeof WEEKDAYS)[number]['key'];

interface IntervalRow {
  key: string;
  id?: number;
  start: string; // HH:MM
  end: string; // HH:MM
  sun: boolean;
  mon: boolean;
  tue: boolean;
  wed: boolean;
  thu: boolean;
  fri: boolean;
  sat: boolean;
}

function secondsToHHMM(secondsValue: string): string {
  const totalSeconds = Number(secondsValue) || 0;
  // `<input type="time">` only accepts 00:00–23:59; the device's documented
  // end-of-day sentinel (86400) has no valid HH:MM representation, so it is
  // clamped to the last displayable minute instead of rendering "24:00".
  if (totalSeconds >= 86400) return '23:59';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function hhmmToSeconds(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map((part) => Number(part) || 0);
  return hours * 3600 + minutes * 60;
}

function spanToIntervalRow(span: TimeSpanRow): IntervalRow {
  return {
    key: `existing-${span.id}`,
    id: span.id,
    start: secondsToHHMM(span.start),
    end: secondsToHHMM(span.end),
    sun: span.sun === '1',
    mon: span.mon === '1',
    tue: span.tue === '1',
    wed: span.wed === '1',
    thu: span.thu === '1',
    fri: span.fri === '1',
    sat: span.sat === '1',
  };
}

function intervalRowsEqual(a: IntervalRow, b: IntervalRow): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.sun === b.sun &&
    a.mon === b.mon &&
    a.tue === b.tue &&
    a.wed === b.wed &&
    a.thu === b.thu &&
    a.fri === b.fri &&
    a.sat === b.sat
  );
}

function newInterval(key: string): IntervalRow {
  return {
    key,
    start: '00:00',
    end: '00:00',
    sun: false,
    mon: false,
    tue: false,
    wed: false,
    thu: false,
    fri: false,
    sat: false,
  };
}

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

  const [intervalRows, setIntervalRows] = useState<IntervalRow[]>([]);
  const [originalIntervalsById, setOriginalIntervalsById] = useState<Map<number, IntervalRow>>(
    new Map()
  );
  const [loadingIntervals, setLoadingIntervals] = useState(false);
  const nextNewIntervalId = React.useRef(0);

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

  const handleOpenEdit = async (timeZone: TimeZoneItem) => {
    setEditingTimeZone(timeZone);
    setEditFormData({ name: timeZone.name });
    setError(null);
    setLoadingIntervals(true);
    try {
      const spansData = await fcgiFetch<LoadTimeSpansResponse>(
        '/load_objects.fcgi?object=time_spans',
        {
          method: 'POST',
          body: JSON.stringify({ object: 'time_spans', where: { time_zone_id: timeZone.id } }),
        }
      );
      const rows = (spansData.time_spans || []).map(spanToIntervalRow);
      setIntervalRows(rows);
      setOriginalIntervalsById(new Map(rows.map((row) => [row.id as number, row])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar intervalos do horário');
    } finally {
      setLoadingIntervals(false);
    }
  };

  const closeEditModal = () => {
    setEditingTimeZone(null);
    setEditFormData(INITIAL_FORM_DATA);
    setIntervalRows([]);
    setOriginalIntervalsById(new Map());
  };

  const handleAddInterval = () => {
    const key = `new-${nextNewIntervalId.current++}`;
    setIntervalRows((prev) => [...prev, newInterval(key)]);
  };

  const handleRemoveInterval = (key: string) => {
    setIntervalRows((prev) => prev.filter((row) => row.key !== key));
  };

  const handleToggleIntervalDay = (key: string, day: WeekdayKey) => {
    setIntervalRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [day]: !row[day] } : row))
    );
  };

  const handleIntervalTimeChange = (key: string, field: 'start' | 'end', value: string) => {
    setIntervalRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  };

  const handleEditTimeZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTimeZone) return;
    if (editFormData.name.trim().length === 0) {
      setError('O nome do horário é obrigatório');
      return;
    }

    for (const row of intervalRows) {
      const hasDay = row.sun || row.mon || row.tue || row.wed || row.thu || row.fri || row.sat;
      if (!hasDay) {
        setError('Cada intervalo precisa de ao menos um dia da semana marcado');
        return;
      }
      if (hhmmToSeconds(row.start) >= hhmmToSeconds(row.end)) {
        setError('O horário de início deve ser anterior ao horário de término');
        return;
      }
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

      const currentIds = new Set(
        intervalRows.filter((row) => row.id !== undefined).map((row) => row.id as number)
      );
      const idsToDestroy: number[] = [];
      for (const id of originalIntervalsById.keys()) {
        if (!currentIds.has(id)) idsToDestroy.push(id);
      }

      const rowsToCreate: IntervalRow[] = [];
      for (const row of intervalRows) {
        if (row.id === undefined) {
          rowsToCreate.push(row);
          continue;
        }
        const original = originalIntervalsById.get(row.id);
        if (original && !intervalRowsEqual(original, row)) {
          idsToDestroy.push(row.id);
          rowsToCreate.push(row);
        }
      }

      const timeZoneId = editingTimeZone.id;
      await Promise.all([
        ...idsToDestroy.map((id) =>
          fcgiFetch('/destroy_objects.fcgi?object=time_spans', {
            method: 'POST',
            body: JSON.stringify({ object: 'time_spans', where: { id } }),
          })
        ),
        ...rowsToCreate.map((row) =>
          fcgiFetch('/create_objects.fcgi?object=time_spans', {
            method: 'POST',
            body: JSON.stringify({
              object: 'time_spans',
              values: [
                {
                  time_zone_id: String(timeZoneId),
                  start: String(hhmmToSeconds(row.start)),
                  end: String(hhmmToSeconds(row.end)),
                  sun: row.sun ? '1' : '0',
                  mon: row.mon ? '1' : '0',
                  tue: row.tue ? '1' : '0',
                  wed: row.wed ? '1' : '0',
                  thu: row.thu ? '1' : '0',
                  fri: row.fri ? '1' : '0',
                  sat: row.sat ? '1' : '0',
                  hol1: '0',
                  hol2: '0',
                  hol3: '0',
                },
              ],
            }),
          })
        ),
      ]);

      closeEditModal();
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
                onClick={closeEditModal}
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

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Intervalos
                  </span>
                  <button
                    type="button"
                    onClick={handleAddInterval}
                    className="text-xs font-semibold text-sky-400 hover:text-sky-300"
                  >
                    + Adicionar intervalo
                  </button>
                </div>
                {loadingIntervals ? (
                  <p className="text-xs text-slate-400 p-2">Carregando intervalos...</p>
                ) : intervalRows.length === 0 ? (
                  <p className="text-xs text-slate-400 p-2">Nenhum intervalo cadastrado.</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-3 space-y-3">
                    {intervalRows.map((row) => (
                      <div
                        key={row.key}
                        className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAYS.map((day) => (
                            <label
                              key={day.key}
                              className="flex items-center gap-1 text-xs text-slate-200 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                aria-label={day.label}
                                checked={row[day.key]}
                                onChange={() => handleToggleIntervalDay(row.key, day.key)}
                                className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
                              />
                              {day.label}
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-slate-400">
                            Início
                            <input
                              type="time"
                              aria-label={`Início do intervalo ${row.key}`}
                              value={row.start}
                              onChange={(e) =>
                                handleIntervalTimeChange(row.key, 'start', e.target.value)
                              }
                              className="ml-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white"
                            />
                          </label>
                          <label className="text-xs text-slate-400">
                            Término
                            <input
                              type="time"
                              aria-label={`Término do intervalo ${row.key}`}
                              value={row.end}
                              onChange={(e) =>
                                handleIntervalTimeChange(row.key, 'end', e.target.value)
                              }
                              className="ml-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => handleRemoveInterval(row.key)}
                            aria-label={`Remover intervalo ${row.key}`}
                            className="ml-auto text-xs font-semibold text-rose-400 hover:text-rose-300"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
