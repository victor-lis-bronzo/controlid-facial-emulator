import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFcgi } from '../hooks/useFcgi.ts';

interface DashboardCounts {
  users: number;
  groups: number;
  timeZones: number;
  portals: number;
  accessRules: number;
  accessLogsTotal: number;
}

interface CountCardDef {
  key: keyof Omit<DashboardCounts, 'accessLogsTotal'>;
  label: string;
  path: string;
}

const COUNT_CARDS: CountCardDef[] = [
  { key: 'users', label: 'Usuários', path: '/admin/users' },
  { key: 'groups', label: 'Grupos', path: '/admin/groups' },
  { key: 'timeZones', label: 'Horários', path: '/admin/time-zones' },
  { key: 'portals', label: 'Portais', path: '/admin/portals' },
  { key: 'accessRules', label: 'Regras de Acesso', path: '/admin/access-rules' },
];

export function DashboardPage() {
  const { fcgiFetch } = useFcgi();
  const navigate = useNavigate();

  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersData, groupsData, timeZonesData, portalsData, accessRulesData, accessLogsData] =
        await Promise.all([
          fcgiFetch<{ users?: unknown[] }>('/load_objects.fcgi?object=users', {
            method: 'POST',
            body: JSON.stringify({ object: 'users' }),
          }),
          fcgiFetch<{ groups?: unknown[] }>('/load_objects.fcgi?object=groups', {
            method: 'POST',
            body: JSON.stringify({ object: 'groups' }),
          }),
          fcgiFetch<{ time_zones?: unknown[] }>('/load_objects.fcgi?object=time_zones', {
            method: 'POST',
            body: JSON.stringify({ object: 'time_zones' }),
          }),
          fcgiFetch<{ portals?: unknown[] }>('/load_objects.fcgi?object=portals', {
            method: 'POST',
            body: JSON.stringify({ object: 'portals' }),
          }),
          fcgiFetch<{ access_rules?: unknown[] }>('/load_objects.fcgi?object=access_rules', {
            method: 'POST',
            body: JSON.stringify({ object: 'access_rules' }),
          }),
          fcgiFetch<{ access_logs?: unknown[] }>('/load_objects.fcgi?object=access_logs', {
            method: 'POST',
            body: JSON.stringify({ object: 'access_logs' }),
          }),
        ]);

      setCounts({
        users: (usersData.users || []).length,
        groups: (groupsData.groups || []).length,
        timeZones: (timeZonesData.time_zones || []).length,
        portals: (portalsData.portals || []).length,
        accessRules: (accessRulesData.access_rules || []).length,
        accessLogsTotal: (accessLogsData.access_logs || []).length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o dashboard');
    } finally {
      setLoading(false);
    }
  }, [fcgiFetch]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 aria-label="Dashboard" className="text-2xl font-bold tracking-tight text-white">
          Início
        </h2>
        <p className="text-sm text-slate-400 mt-1">Visão geral da leitora</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-400">Carregando...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {COUNT_CARDS.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => navigate(card.path)}
              className="text-left rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm hover:bg-slate-800/60 hover:border-sky-500/40 transition-colors cursor-pointer"
            >
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {card.label}
              </div>
              <div className="mt-1 text-2xl font-bold text-white">{counts?.[card.key] ?? 0}</div>
            </button>
          ))}

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Logs de Acesso
            </div>
            <div className="mt-1 text-2xl font-bold text-white">{counts?.accessLogsTotal ?? 0}</div>
          </div>
        </div>
      )}
    </div>
  );
}
