import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { adminAccessLogs } from '../api/client.ts';
import type { AccessLogFilter, AccessLogRecord } from '../api/types.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { ResourceTable } from '../components/ResourceTable.tsx';
import { ACCESS_EVENT_OPTIONS, eventLabel, formatEpoch } from './accessEvents.ts';

type LoadStatus = 'loading' | 'ready' | 'error';

interface FilterState {
  userId: string;
  event: string;
  from: string;
  to: string;
}

const EMPTY_FILTER: FilterState = { userId: '', event: '', from: '', to: '' };

/**
 * Access Logs section (Req 8): a filterable table (user id / event type / date
 * range) over `adminAccessLogs`, newest-first, with an explicit empty-state.
 * A 400 on an invalid filter value is surfaced inline; the API already returns
 * records newest-first (Req 8.1), so the received order is preserved.
 */
export function AccessLogsSection() {
  const [records, setRecords] = useState<AccessLogRecord[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);

  const runQuery = useCallback(async (active: FilterState) => {
    setStatus('loading');
    setError(null);
    try {
      // Dates from <input type="date"> convert to inclusive day bounds.
      const query: AccessLogFilter = {
        userId: active.userId,
        event: active.event,
        from: active.from !== '' ? String(Math.floor(new Date(`${active.from}T00:00:00`).getTime() / 1000)) : '',
        to: active.to !== '' ? String(Math.floor(new Date(`${active.to}T23:59:59`).getTime() / 1000)) : '',
      };
      setRecords(await adminAccessLogs.list(query));
      setStatus('ready');
    } catch (caught) {
      setError(caught);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void runQuery(EMPTY_FILTER);
  }, [runQuery]);

  const apply = (event: FormEvent): void => {
    event.preventDefault();
    void runQuery(filter);
  };

  const reset = (): void => {
    setFilter(EMPTY_FILTER);
    void runQuery(EMPTY_FILTER);
  };

  return (
    <section className="card" aria-labelledby="access-logs-title">
      <div className="section-header">
        <h2 className="card__title" id="access-logs-title" style={{ margin: 0 }}>
          Access Logs
        </h2>
      </div>

      <form className="filter-row" onSubmit={apply}>
        <label className="field">
          <span className="field__label">User id</span>
          <input
            className="select"
            type="text"
            inputMode="numeric"
            value={filter.userId}
            onChange={(e) => setFilter({ ...filter, userId: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">Event</span>
          <select
            className="select"
            value={filter.event}
            onChange={(e) => setFilter({ ...filter, event: e.target.value })}
          >
            <option value="">All events</option>
            {ACCESS_EVENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">From</span>
          <input
            className="select"
            type="date"
            value={filter.from}
            onChange={(e) => setFilter({ ...filter, from: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">To</span>
          <input
            className="select"
            type="date"
            value={filter.to}
            onChange={(e) => setFilter({ ...filter, to: e.target.value })}
          />
        </label>
        <div className="button-row">
          <button type="submit" className="button" disabled={status === 'loading'}>
            Apply filters
          </button>
          <button type="button" className="button button--secondary" onClick={reset}>
            Reset
          </button>
        </div>
      </form>

      {status === 'loading' && <p className="alert alert--info">Loading access logs…</p>}
      {status === 'error' && <ErrorBanner error={error} context="Failed to load access logs" />}

      {status === 'ready' && (
        <ResourceTable<AccessLogRecord>
          columns={[
            { key: 'time', header: 'Time', render: (r) => formatEpoch(r.time) },
            { key: 'event', header: 'Event', render: (r) => eventLabel(r.event) },
            { key: 'user', header: 'User', render: (r) => r.user_id },
            { key: 'portal', header: 'Portal', render: (r) => r.portal_id },
            { key: 'device', header: 'Device', render: (r) => r.device_id },
          ]}
          rows={records}
          rowKey={(r) => r.id}
          emptyMessage="No access log records match the current filters."
        />
      )}
    </section>
  );
}
