import { useCallback, useEffect, useState } from 'react';
import { adminDashboard } from '../api/client.ts';
import type { DashboardData } from '../api/types.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { ResourceTable } from '../components/ResourceTable.tsx';
import type { AccessLogRecord } from '../api/types.ts';
import { eventLabel, formatEpoch } from './accessEvents.ts';

type LoadStatus = 'loading' | 'ready' | 'error';

const CARDS: ReadonlyArray<{ key: keyof DashboardData['counts']; label: string }> = [
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
  { key: 'accessRules', label: 'Access Rules' },
  { key: 'portals', label: 'Portals' },
];

/**
 * Dashboard section (Req 9): aggregate counts of Users/Groups/Access
 * Rules/Portals plus the 10 most-recent Access Log records from
 * `GET /api/admin/dashboard`.
 */
export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      setData(await adminDashboard.get());
      setStatus('ready');
    } catch (caught) {
      setError(caught);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card" aria-labelledby="dashboard-title">
      <div className="section-header">
        <h2 className="card__title" id="dashboard-title" style={{ margin: 0 }}>
          Dashboard
        </h2>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void load()}
          disabled={status === 'loading'}
        >
          Refresh
        </button>
      </div>

      {status === 'loading' && <p className="alert alert--info">Loading dashboard…</p>}
      {status === 'error' && <ErrorBanner error={error} context="Failed to load dashboard" />}

      {status === 'ready' && data !== null && (
        <>
          <div className="stat-grid">
            {CARDS.map((card) => (
              <div key={card.key} className="stat-card">
                <span className="stat-card__value">{data.counts[card.key]}</span>
                <span className="stat-card__label">{card.label}</span>
              </div>
            ))}
          </div>

          <h3 className="card__title" style={{ marginTop: '1.5rem' }}>
            Recent access events
          </h3>
          <ResourceTable<AccessLogRecord>
            columns={[
              { key: 'time', header: 'Time', render: (r) => formatEpoch(r.time) },
              { key: 'event', header: 'Event', render: (r) => eventLabel(r.event) },
              { key: 'user', header: 'User', render: (r) => r.user_id },
              { key: 'portal', header: 'Portal', render: (r) => r.portal_id },
            ]}
            rows={data.recentLogs}
            rowKey={(r) => r.id}
            emptyMessage="No access events recorded yet."
          />
        </>
      )}
    </section>
  );
}
