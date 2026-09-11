import type { PushOutcome } from '../api/types.ts';

interface PushOutcomeViewProps {
  /** Label describing which event produced this outcome. */
  label: string;
  /** The dispatch outcome returned by the API. */
  outcome: PushOutcome;
}

/**
 * Renders a {@link PushOutcome} returned by a simulate request so the developer
 * can see the target, success, attempts and failure category (Req 7.6, 7.7).
 */
export function PushOutcomeView({ label, outcome }: PushOutcomeViewProps) {
  return (
    <div className="outcome" role="status" aria-live="polite">
      <div className="outcome__heading">
        <span>{label}</span>
        <span
          className={`badge ${outcome.success ? 'badge--success' : 'badge--failure'}`}
        >
          {outcome.success ? 'success' : 'failure'}
        </span>
      </div>
      <dl className="detail-list">
        <dt>Target</dt>
        <dd>{outcome.target ?? '— (no target configured)'}</dd>
        <dt>Attempts</dt>
        <dd>{outcome.attempts}</dd>
        {typeof outcome.statusCode === 'number' && (
          <>
            <dt>Status code</dt>
            <dd>{outcome.statusCode}</dd>
          </>
        )}
        {outcome.timedOut === true && (
          <>
            <dt>Timed out</dt>
            <dd>yes</dd>
          </>
        )}
        {outcome.failureCategory !== undefined && (
          <>
            <dt>Failure</dt>
            <dd>{outcome.failureCategory}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
