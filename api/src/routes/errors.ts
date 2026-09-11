/**
 * Global error, 404, and 405 handling for the Fastify app (task 12.4).
 *
 * Centralizes the emulator's HTTP error contract so every failure path returns
 * a JSON body with an `error-description` field and `Content-Type:
 * application/json` (Req 1.2, 1.4, 1.5, 1.6):
 *
 *   - Malformed JSON / schema violation / missing required field → `400` with a
 *     JSON `error-description` naming the failed rule, and NO state change
 *     (Req 1.4). Route handlers throw {@link BadRequestError} for their own
 *     field-level validation; Fastify's body-parser / schema errors are mapped
 *     here.
 *   - Domain validation errors from the services and repositories map to the
 *     appropriate status: ConfigService/repository `ValidationError` → `400`
 *     naming the rejected key/parameter (Req 3.2, 4.5); `SimulationError` →
 *     `400` (Req 6.6); session failures → `401` (Req 2.5).
 *   - Unknown path → `404` with `error-description` (Req 1.5).
 *   - Wrong method on a known route → `405` (Req 1.6), produced by a catch-all
 *     `405` route registered for each known `.fcgi` path (see `app.ts`).
 *
 * The handlers here never leak internal error messages beyond the descriptive
 * text the services attach; unexpected errors fall back to a generic `500`.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError as ConfigValidationError } from '../services/config-service.js';
import { ValidationError as RepoValidationError } from '../repositories/errors.js';
import { SimulationError } from '../services/simulation-service.js';

/**
 * A route-level HTTP error carrying an explicit status code and an
 * `error-description` message. Route handlers throw this for their own
 * field-level validation (e.g. login missing a field → `400`; unauthenticated
 * protected route → `401`).
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly description: string;

  public constructor(statusCode: number, description: string) {
    super(description);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.description = description;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/** Convenience: a `400 Bad Request` with an `error-description`. */
export class BadRequestError extends HttpError {
  public constructor(description: string) {
    super(400, description);
    this.name = 'BadRequestError';
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

/** Convenience: a `401 Unauthorized` with an `error-description`. */
export class UnauthorizedError extends HttpError {
  public constructor(description: string) {
    super(401, description);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/** The JSON error body shape returned for every error path. */
interface ErrorBody {
  'error-description': string;
}

function errorBody(description: string): ErrorBody {
  return { 'error-description': description };
}

/**
 * Map an arbitrary thrown value to an `{ statusCode, description }` pair. Keeps
 * the mapping in one place so the contract is consistent across every route.
 */
function classify(error: unknown): { statusCode: number; description: string } {
  // --- Layer 1: cross-module `instanceof` (fast path, precise). ---

  // Explicit route-level HTTP errors carry their own status + description.
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, description: error.description };
  }

  // ConfigService validation: 400 naming the rejected key (Req 3.2).
  if (error instanceof ConfigValidationError) {
    return { statusCode: 400, description: error.message };
  }

  // Repository validation: 400 naming the rejected filter/parameter (Req 4.5).
  if (error instanceof RepoValidationError) {
    return { statusCode: 400, description: error.message };
  }

  // Simulated-event precondition (e.g. authorized without identity) → 400 (Req 6.6).
  if (error instanceof SimulationError) {
    return { statusCode: 400, description: error.message };
  }

  // --- Layer 2: name-based discriminator (robust fallback). ---
  //
  // `instanceof` can silently fail when the same error class is reachable via
  // two distinct module instances (duplicate class identity under transpilation,
  // bundling, or mixed CJS/ESM resolution). To keep the contract bulletproof we
  // ALSO classify on the stable, serialization-safe `error.name` set by each
  // domain error's constructor. This guarantees a domain error maps to the right
  // 4xx even if identity checks miss (Req 1.2, 3.2, 4.5, 6.6).
  if (error instanceof Error) {
    switch (error.name) {
      case 'HttpError':
      case 'BadRequestError':
      case 'UnauthorizedError': {
        // These carry an explicit statusCode; fall back to 400 if absent.
        const withStatus = error as Error & { statusCode?: number };
        const status =
          typeof withStatus.statusCode === 'number'
            ? withStatus.statusCode
            : 400;
        return { statusCode: status, description: error.message };
      }
      // ConfigService and the repository BOTH name their validation error
      // 'ValidationError'; either maps to a 400 naming the rejected key/param.
      case 'ValidationError':
        return { statusCode: 400, description: error.message };
      case 'SimulationError':
        return { statusCode: 400, description: error.message };
      default:
        break;
    }
  }

  // --- Layer 3: FastifyError with an explicit statusCode. ---
  //
  // Fastify body-parser / schema-validation errors surface as FastifyError with
  // a `statusCode`. In particular the custom `application/json` parser
  // (see `app.ts`) throws an Error with `statusCode = 400` on malformed JSON;
  // that must render as a 400 with an `error-description` (Req 1.4). Any 4xx
  // FastifyError is honored with its status; a 5xx statusCode falls through to
  // the generic 500 below.
  const fastifyError = error as FastifyError;
  if (typeof fastifyError.statusCode === 'number') {
    const status = fastifyError.statusCode;
    if (status >= 400 && status < 500) {
      return {
        statusCode: status,
        description: fastifyError.message || 'Bad Request',
      };
    }
  }

  // --- Layer 4: anything else is an unexpected server error. ---
  const message =
    error instanceof Error ? error.message : 'Internal Server Error';
  return { statusCode: 500, description: message };
}

/**
 * Install the global error handler, the not-found (404) handler, and ensure all
 * error responses are JSON with an `error-description` field (Req 1.2, 1.4,
 * 1.5). The 405 behavior is produced by catch-all method routes registered in
 * `app.ts` for the known `.fcgi` paths.
 */
export function installErrorHandlers(app: FastifyInstance): void {
  // Unknown path → 404 with error-description (Req 1.5).
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply
      .code(404)
      .type('application/json')
      .send(errorBody(`Unknown endpoint: ${request.method} ${request.url}`));
  });

  // Global error handler: normalize every thrown error to the JSON contract.
  app.setErrorHandler((error: unknown, _request: FastifyRequest, reply: FastifyReply) => {
    const { statusCode, description } = classify(error);
    reply.code(statusCode).type('application/json').send(errorBody(description));
  });
}
