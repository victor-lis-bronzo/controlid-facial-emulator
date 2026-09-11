/**
 * PushEngine — dispatches outbound webhooks (the Monitor mechanism) to the
 * configured Push_Target with a bounded per-request timeout and a fixed-interval
 * retry policy, and reports a structured {@link PushOutcome}.
 *
 * Behavior (Req 5.1, 5.2, 5.5, 5.6, 5.7, 5.8; design.md → "Components and
 * Interfaces → PushEngine", "Push / Webhook Payload Catalog", "Error Handling"):
 *
 *   - `resolvePushTarget(endpoint)` reads the base target from
 *     {@link ConfigService.resolvePushTarget} (`http://<hostname>:<port>/<path>`)
 *     and appends `/<endpoint>` with a single slash join. Returns `null` when no
 *     target is configured (Req 5.1, 5.5).
 *   - `dispatch(endpoint, payload)`:
 *       - When no target is configured, records a `no_target` outbound entry and
 *         returns without attempting any HTTP POST (Req 5.5).
 *       - Otherwise POSTs the JSON payload with a 10 s per-request timeout
 *         (Req 5.6). A response status in 200–299 is a success (Req 5.2).
 *       - On timeout, connection failure, or non-2xx, it retries up to
 *         {@link maxRetries} times with a fixed {@link retryIntervalMs} interval
 *         between attempts — up to 4 attempts total (Req 5.7).
 *       - Every outcome (success or, after retries are exhausted, failure) is
 *         recorded in the {@link InterceptionLogger} with the target, attempts,
 *         and status/timeout/failure category (Req 8.3, 8.4, 5.8).
 *
 * The HTTP client and the retry `sleep` are injectable so property/unit tests can
 * run without real network access or real timer delays. The default HTTP client
 * uses undici's `request` with an abort-based timeout, mapping an abort/timeout to
 * a timeout result and connection errors to `unreachable`.
 *
 * This service performs no Fastify/HTTP-framework work — it is pure dispatch.
 */
import { request } from 'undici';
import type { ConfigService } from './config-service.js';
import type { InterceptionLogger } from './interception-logger.js';
import type { PushFailureCategory, PushOutcome } from '../shared/index.js';

/**
 * The result of a single HTTP attempt made by the injected client. Only the
 * status code is needed by the engine; the body is irrelevant to the outcome.
 */
export interface HttpPostResult {
  statusCode: number;
}

/**
 * The injectable HTTP client function. Implementations POST the JSON `body` to
 * `url`, aborting after `timeoutMs`. They MUST resolve with the response status
 * code, or reject when the target is unreachable or the request times out.
 */
export type HttpPostFn = (
  url: string,
  body: string,
  timeoutMs: number,
) => Promise<HttpPostResult>;

/** The injectable sleep used between retries (real timer by default). */
export type SleepFn = (ms: number) => Promise<void>;

/**
 * Marker error signalling an aborted/timed-out HTTP attempt.
 *
 * The default undici client throws this when its per-request timeout aborts the
 * request; injected clients should also throw a {@link PushTimeoutError} to have
 * the failure classified as `timeout` (rather than `unreachable`). Any other
 * thrown error is classified `unreachable`.
 */
export class PushTimeoutError extends Error {
  constructor(message = 'request timed out') {
    super(message);
    this.name = 'PushTimeoutError';
    Object.setPrototypeOf(this, PushTimeoutError.prototype);
  }
}

/** Dependencies required to construct a {@link PushEngine}. */
export interface PushEngineDeps {
  config: ConfigService;
  logger: InterceptionLogger;
  /** Injectable HTTP client; defaults to an undici-backed implementation. */
  httpPost?: HttpPostFn;
  /** Injectable retry sleep; defaults to a real `setTimeout`-backed timer. */
  sleep?: SleepFn;
}

/**
 * Default HTTP client backed by undici. POSTs `body` as JSON, aborting the
 * request after `timeoutMs`. An abort/timeout is mapped to a {@link TimeoutError}
 * (classified `timeout`); any other thrown error propagates and is classified
 * `unreachable`.
 */
const defaultHttpPost: HttpPostFn = async (url, body, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
    // Drain the body so the connection can be reused; the value is unused.
    await response.body.text();
    return { statusCode: response.statusCode };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new PushTimeoutError();
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
};

/** Default real-timer sleep. */
const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class PushEngine {
  /** Per-request timeout in milliseconds (Req 5.6). */
  public readonly timeoutMs = 10_000;

  /** Maximum retries after the first attempt — up to 4 attempts total (Req 5.7). */
  public readonly maxRetries = 3;

  /** Fixed interval between attempts in milliseconds (Req 5.7). */
  public readonly retryIntervalMs = 5_000;

  private readonly config: ConfigService;
  private readonly logger: InterceptionLogger;
  private readonly httpPost: HttpPostFn;
  private readonly sleep: SleepFn;

  public constructor(deps: PushEngineDeps) {
    this.config = deps.config;
    this.logger = deps.logger;
    this.httpPost = deps.httpPost ?? defaultHttpPost;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /**
   * Compose the final webhook destination URL for `endpoint`.
   *
   * Reads the base target from {@link ConfigService.resolvePushTarget}
   * (`http://<hostname>:<port>/<path>`). Returns `null` when no target is
   * configured (Req 5.1, 5.5); otherwise appends `/<endpoint>` with a single
   * slash join (no double slashes).
   */
  public async resolvePushTarget(endpoint: string): Promise<string | null> {
    const base = await this.config.resolvePushTarget();
    if (base === null) {
      return null;
    }
    const cleanBase = base.replace(/\/+$/, '');
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    return `${cleanBase}/${cleanEndpoint}`;
  }

  /**
   * Dispatch a webhook `payload` to the configured target for `endpoint`.
   *
   * When no target is configured, records a `no_target` outbound entry and
   * returns `{ success:false, target:null, attempts:0,
   * failureCategory:'no_target' }` WITHOUT any HTTP attempt (Req 5.5).
   *
   * Otherwise POSTs the JSON payload with a {@link timeoutMs} timeout, treating a
   * 200–299 status as success (Req 5.2). On timeout/unreachable/non-2xx it
   * retries up to {@link maxRetries} times with {@link retryIntervalMs} between
   * attempts (Req 5.7). Records the dispatch outcome in the interception log in
   * all cases (Req 8.3, 8.4, 5.8).
   */
  public async dispatch(
    endpoint: string,
    payload: unknown,
  ): Promise<PushOutcome> {
    const target = await this.resolvePushTarget(endpoint);
    const body = JSON.stringify(payload ?? null);

    // --- No target configured: record no_target, no POST (Req 5.5). ---
    if (target === null) {
      await this.logger.recordOutbound({
        method: 'POST',
        path: endpoint === '' ? '<no-target>' : endpoint,
        body,
        truncated: false,
        outcome: 'no_target',
        attempts: 0,
        failureCategory: 'no_target',
      });
      return {
        success: false,
        target: null,
        attempts: 0,
        failureCategory: 'no_target',
      };
    }

    // --- Attempt with bounded retries (up to 1 + maxRetries total). ---
    const maxAttempts = this.maxRetries + 1;
    let attempts = 0;
    let lastStatusCode: number | undefined;
    let lastTimedOut = false;
    let lastFailureCategory: PushFailureCategory = 'unreachable';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      // Reset per-attempt failure signals.
      lastStatusCode = undefined;
      lastTimedOut = false;

      try {
        const { statusCode } = await this.httpPost(target, body, this.timeoutMs);
        lastStatusCode = statusCode;
        if (statusCode >= 200 && statusCode <= 299) {
          // Success (Req 5.2): record and return immediately.
          await this.logger.recordOutbound({
            method: 'POST',
            path: target,
            body,
            truncated: false,
            outcome: 'success',
            statusCode,
            attempts,
          });
          return { success: true, target, statusCode, attempts };
        }
        // Non-2xx: an HTTP error; retry unless attempts exhausted.
        lastFailureCategory = 'http_error';
      } catch (err) {
        if (err instanceof PushTimeoutError) {
          lastTimedOut = true;
          lastFailureCategory = 'timeout';
        } else {
          lastFailureCategory = 'unreachable';
        }
      }

      // Wait a fixed interval before the next attempt (not after the last).
      if (attempt < maxAttempts) {
        await this.sleep(this.retryIntervalMs);
      }
    }

    // --- All attempts exhausted: record the failure (Req 5.8). ---
    const outcome: PushOutcome = {
      success: false,
      target,
      attempts,
      failureCategory: lastFailureCategory,
    };
    if (lastStatusCode !== undefined) {
      outcome.statusCode = lastStatusCode;
    }
    if (lastTimedOut) {
      outcome.timedOut = true;
    }

    await this.logger.recordOutbound({
      method: 'POST',
      path: target,
      body,
      truncated: false,
      outcome: 'failure',
      statusCode: lastStatusCode,
      attempts,
      failureCategory: lastFailureCategory,
    });

    return outcome;
  }
}
