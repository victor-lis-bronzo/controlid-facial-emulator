import { useState, useEffect, useCallback } from 'react';
import { useFcgi } from '../hooks/useFcgi.ts';

interface IdentityRecord {
  id: number;
  registration: string;
  name: string;
}

type PushFailureCategory = 'no_target' | 'timeout' | 'unreachable' | 'http_error';

interface PushOutcome {
  success: boolean;
  target: string | null;
  statusCode?: number;
  timedOut?: boolean;
  attempts: number;
  failureCategory?: PushFailureCategory;
}

type InterceptionDirection = 'inbound' | 'outbound';
type InterceptionOutcome = 'success' | 'failure' | 'no_target';

interface InterceptionRecord {
  id: number;
  direction: InterceptionDirection;
  method: string;
  path: string;
  timestamp: string;
  outcome?: InterceptionOutcome;
  statusCode?: number;
  failureCategory?: PushFailureCategory;
}

type SimulateAction = 'authorized' | 'denied' | 'keep-alive';

const ACTION_LABELS: Record<SimulateAction, string> = {
  authorized: 'Acesso Autorizado',
  denied: 'Acesso Negado',
  'keep-alive': 'Keep-Alive',
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function outcomeLabel(record: InterceptionRecord): string {
  const parts = [record.outcome, record.statusCode, record.failureCategory].filter(
    (part) => part !== undefined && part !== null
  );
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function DebugConsolePage() {
  const { fcgiFetch } = useFcgi();

  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [identitiesError, setIdentitiesError] = useState<string | null>(null);
  const [selectedIdentityId, setSelectedIdentityId] = useState<number | null>(null);

  const [pendingAction, setPendingAction] = useState<SimulateAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<{ label: string; outcome: PushOutcome } | null>(null);

  const [interceptionRecords, setInterceptionRecords] = useState<InterceptionRecord[]>([]);
  const [interceptionLoading, setInterceptionLoading] = useState(true);
  const [interceptionError, setInterceptionError] = useState<string | null>(null);

  const loadIdentities = useCallback(async () => {
    try {
      setIdentitiesError(null);
      const data = await fcgiFetch<IdentityRecord[]>('/api/identities');
      setIdentities(data);
    } catch (err) {
      setIdentitiesError(err instanceof Error ? err.message : 'Erro ao carregar identidades');
    }
  }, [fcgiFetch]);

  const loadInterceptionLog = useCallback(async () => {
    try {
      setInterceptionLoading(true);
      setInterceptionError(null);
      const data = await fcgiFetch<InterceptionRecord[]>('/api/interception');
      setInterceptionRecords(data);
    } catch (err) {
      setInterceptionError(err instanceof Error ? err.message : 'Erro ao carregar o log de interceptação');
    } finally {
      setInterceptionLoading(false);
    }
  }, [fcgiFetch]);

  useEffect(() => {
    loadIdentities();
    loadInterceptionLog();
  }, [loadIdentities, loadInterceptionLog]);

  const runAction = async (action: SimulateAction, endpoint: string, body: Record<string, unknown>) => {
    try {
      setPendingAction(action);
      setActionError(null);
      const outcome = await fcgiFetch<PushOutcome>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLastOutcome({ label: ACTION_LABELS[action], outcome });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erro ao simular evento');
    } finally {
      setPendingAction(null);
    }
  };

  const handleAuthorized = () => {
    if (selectedIdentityId === null) return;
    runAction('authorized', '/api/simulate/authorized', { userId: selectedIdentityId });
  };

  const handleDenied = () => runAction('denied', '/api/simulate/denied', {});
  const handleKeepAlive = () => runAction('keep-alive', '/api/simulate/keep-alive', {});

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h2 aria-label="Debug Console" className="text-2xl font-bold tracking-tight text-white">
          Debug Console
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Simule eventos de acesso e acompanhe o log de interceptação sem hardware físico.
        </p>
      </div>

      {/* Simulate panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm mb-6">
        <h3 className="text-lg font-bold text-white mb-4">Simular Evento</h3>

        {identitiesError && (
          <div className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
            {identitiesError}
          </div>
        )}

        <div className="mb-4">
          <label
            htmlFor="identity-select"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
          >
            Identity
          </label>
          <select
            id="identity-select"
            aria-label="Identity"
            value={selectedIdentityId ?? ''}
            onChange={(e) => setSelectedIdentityId(e.target.value === '' ? null : Number(e.target.value))}
            disabled={identities.length === 0}
            className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="">Selecione uma identidade</option>
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.name} (#{identity.registration})
              </option>
            ))}
          </select>
        </div>

        {actionError && (
          <div className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
            {actionError}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-4">
          <button
            onClick={handleAuthorized}
            disabled={selectedIdentityId === null || pendingAction !== null}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
          >
            Simular Acesso Autorizado
          </button>
          <button
            onClick={handleDenied}
            disabled={pendingAction !== null}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            Simular Acesso Negado
          </button>
          <button
            onClick={handleKeepAlive}
            disabled={pendingAction !== null}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            Forçar Keep-Alive
          </button>
        </div>

        {lastOutcome && (
          <div role="status" aria-live="polite" className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-white">{lastOutcome.label}</span>
              <span
                className={
                  lastOutcome.outcome.success
                    ? 'text-xs font-semibold text-emerald-400'
                    : 'text-xs font-semibold text-rose-400'
                }
              >
                {lastOutcome.outcome.success ? 'Sucesso' : 'Falha'}
              </span>
            </div>
            <dl className="text-xs text-slate-400 space-y-1">
              <div>
                <dt className="inline font-semibold text-slate-300">Alvo: </dt>
                <dd className="inline">{lastOutcome.outcome.target ?? '(nenhum alvo configurado)'}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-300">Tentativas: </dt>
                <dd className="inline">{lastOutcome.outcome.attempts}</dd>
              </div>
              {typeof lastOutcome.outcome.statusCode === 'number' && (
                <div>
                  <dt className="inline font-semibold text-slate-300">Código de status: </dt>
                  <dd className="inline">{lastOutcome.outcome.statusCode}</dd>
                </div>
              )}
              {lastOutcome.outcome.timedOut === true && (
                <div>
                  <dt className="inline font-semibold text-slate-300">Tempo esgotado: </dt>
                  <dd className="inline">sim</dd>
                </div>
              )}
              {lastOutcome.outcome.failureCategory && (
                <div>
                  <dt className="inline font-semibold text-slate-300">Falha: </dt>
                  <dd className="inline">{lastOutcome.outcome.failureCategory}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>

      {/* Interception Log panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 className="text-lg font-bold text-white">Interception Log</h3>
          <button
            onClick={loadInterceptionLog}
            disabled={interceptionLoading}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            Atualizar
          </button>
        </div>

        {interceptionError && (
          <div className="m-6 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
            {interceptionError}
          </div>
        )}

        {interceptionLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando log de interceptação...</div>
        ) : interceptionRecords.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Nenhum registro de interceptação ainda. Simule um evento para ver requisições e webhooks
            aqui.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-3.5 font-semibold">Direção</th>
                  <th className="px-6 py-3.5 font-semibold">Método</th>
                  <th className="px-6 py-3.5 font-semibold">Caminho / Alvo</th>
                  <th className="px-6 py-3.5 font-semibold">Data/Hora</th>
                  <th className="px-6 py-3.5 font-semibold">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {interceptionRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4">
                      <span
                        className={
                          record.direction === 'inbound'
                            ? 'rounded px-2 py-0.5 text-xs font-semibold bg-sky-500/10 text-sky-400'
                            : 'rounded px-2 py-0.5 text-xs font-semibold bg-violet-500/10 text-violet-400'
                        }
                      >
                        {record.direction === 'inbound' ? 'Entrada' : 'Saída'}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-300">{record.method}</td>
                    <td className="px-6 py-4">
                      <code className="text-xs text-slate-300">{record.path}</code>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">{formatTimestamp(record.timestamp)}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">{outcomeLabel(record)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
