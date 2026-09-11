import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client.ts';
import type { InterceptionRecord } from '../api/types.ts';

type Status = 'loading' | 'ready' | 'error';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function outcomeLabel(record: InterceptionRecord): string {
  const parts: string[] = [];
  if (record.outcome !== undefined) {
    parts.push(record.outcome);
  }
  if (typeof record.statusCode === 'number') {
    parts.push(String(record.statusCode));
  }
  if (record.failureCategory !== undefined) {
    parts.push(record.failureCategory);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * Interception Log view (Req 8.5, 8.6). Fetches `GET /api/interception` and
 * renders records newest-first (the API already returns them newest-first, so
 * the received order is preserved). Shows an explicit empty-state when there
 * are no records (Req 8.6) and offers a manual Refresh control. On a failed
 * fetch a visible error message is shown (Req 7.8).
 */
export function InterceptionLog() {
  const [records, setRecords] = useState<InterceptionRecord[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await api.getInterception();
      // Preserve the newest-first order returned by the API.
      setRecords(result);
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="card" aria-labelledby="log-title">
      <div className="section-header">
        <h2 className="card__title" id="log-title" style={{ margin: 0 }}>
          Interception Log
        </h2>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void refresh()}
          disabled={status === 'loading'}
        >
          Refresh
        </button>
      </div>

      {status === 'loading' && (
        <p className="alert alert--info">Loading interception records…</p>
      )}

      {status === 'error' && (
        <div className="alert alert--error" role="alert">
          Failed to load interception log: {error}
        </div>
      )}

      {status === 'ready' && records.length === 0 && (
        <p className="empty-state" role="status">
          No interception records yet. Simulate an event to see inbound requests
          and outbound webhooks here.
        </p>
      )}

      {status === 'ready' && records.length > 0 && (
        <table className="log-table">
          <thead>
            <tr>
              <th>Direction</th>
              <th>Method</th>
              <th>Path / Target</th>
              <th>Timestamp</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>
                  <span
                    className={`badge ${
                      record.direction === 'inbound'
                        ? 'badge--inbound'
                        : 'badge--outbound'
                    }`}
                  >
                    {record.direction}
                  </span>
                </td>
                <td>{record.method}</td>
                <td>
                  <code>{record.path}</code>
                </td>
                <td>{formatTimestamp(record.timestamp)}</td>
                <td>{outcomeLabel(record)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
