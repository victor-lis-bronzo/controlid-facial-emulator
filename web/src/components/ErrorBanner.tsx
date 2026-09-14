import { ApiError } from '../api/client.ts';

interface ErrorBannerProps {
  /** The error to display; when `null` the banner renders nothing. */
  error: unknown;
  /** Optional context prefix, e.g. "Failed to save group". */
  context?: string;
}

/**
 * Surfaces an {@link ApiError} (or any error) message inline without touching
 * the surrounding form state, so the Administrator can correct the input and
 * resubmit (Req 11.5). Prefers the server's `error-description` carried by
 * {@link ApiError.message}. Renders `null` when there is no error.
 */
export function ErrorBanner({ error, context }: ErrorBannerProps) {
  if (error === null || error === undefined) {
    return null;
  }
  const message =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : String(error);
  const status = error instanceof ApiError ? ` (HTTP ${String(error.status)})` : '';
  return (
    <div className="alert alert--error" role="alert">
      {context !== undefined ? `${context}: ` : ''}
      {message}
      {status}
    </div>
  );
}
