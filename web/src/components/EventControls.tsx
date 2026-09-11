import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client.ts';
import type { PushOutcome, UserRecord } from '../api/types.ts';
import { IdentityPicker } from './IdentityPicker.tsx';
import { PushOutcomeView } from './PushOutcomeView.tsx';

type Status = 'loading' | 'ready' | 'error';

interface LastOutcome {
  label: string;
  outcome: PushOutcome;
}

/**
 * Event simulation controls (Req 7.3–7.7). Fetches identities on mount and
 * offers three actions: authorized (requires a selected identity before it can
 * be activated — Req 7.3), denied, and keep-alive. Each action calls the
 * matching API and renders the returned {@link PushOutcome} (Req 7.6, 7.7).
 *
 * On a failed request an error message is shown and the developer's identity
 * selection is retained without resubmitting (Req 7.8).
 */
export function EventControls() {
  const [identities, setIdentities] = useState<UserRecord[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<LastOutcome | null>(null);

  const loadIdentities = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    try {
      const records = await api.getIdentities();
      setIdentities(records);
      setStatus('ready');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  /**
   * Runs a simulate action. On failure the error is surfaced and the current
   * selection is preserved (no state reset, no resubmit) per Req 7.8.
   */
  const runAction = useCallback(
    async (label: string, action: () => Promise<PushOutcome>) => {
      setPending(true);
      setActionError(null);
      try {
        const outcome = await action();
        setLastOutcome({ label, outcome });
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    },
    []
  );

  const authorizedDisabled = pending || selectedId === null;

  return (
    <section className="card" aria-labelledby="controls-title">
      <h2 className="card__title" id="controls-title">
        Simulate Access Event
      </h2>

      {status === 'loading' && (
        <p className="alert alert--info">Loading identities…</p>
      )}

      {status === 'error' && (
        <div className="alert alert--error" role="alert">
          Failed to load identities: {loadError}{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void loadIdentities()}
          >
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && identities.length === 0 && (
        <p className="alert alert--info">
          No identities are available to select.
        </p>
      )}

      {status === 'ready' && (
        <IdentityPicker
          identities={identities}
          selectedId={selectedId}
          onSelect={setSelectedId}
          disabled={pending}
        />
      )}

      {actionError !== null && (
        <div className="alert alert--error" role="alert">
          Request failed: {actionError}
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          className="button"
          disabled={authorizedDisabled}
          onClick={() =>
            selectedId !== null &&
            void runAction('Authorized access', () =>
              api.simulateAuthorized(selectedId)
            )
          }
        >
          Simulate Authorized Access
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={pending}
          onClick={() =>
            void runAction('Denied access', () => api.simulateDenied())
          }
        >
          Simulate Denied Access
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={pending}
          onClick={() =>
            void runAction('Keep-alive', () => api.simulateKeepAlive())
          }
        >
          Force Keep Alive
        </button>
      </div>

      {lastOutcome !== null && (
        <PushOutcomeView
          label={lastOutcome.label}
          outcome={lastOutcome.outcome}
        />
      )}
    </section>
  );
}
