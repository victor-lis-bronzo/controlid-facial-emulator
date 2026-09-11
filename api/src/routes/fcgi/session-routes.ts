/**
 * Session and login `.fcgi` routes plus the reusable session guard (task 12.1).
 *
 * Registers the two unprotected session endpoints and exposes a `requireSession`
 * preHandler that protected routes attach to short-circuit to `401` on an
 * absent/empty/malformed/expired token (Req 2.5):
 *
 *   - `POST /login.fcgi` (Req 2.1, 2.2, 2.3): validates the `login`/`password`
 *     body; `400` naming the missing field when either is absent; `401` on a
 *     credential mismatch against the resolved admin credentials; otherwise
 *     issues a token via {@link SessionService} and returns `{ session }`.
 *   - `POST /session_is_valid.fcgi`: returns `{ session_is_valid: boolean }`
 *     from `SessionService.validate(...) === 'valid'`.
 *   - `requireSession`: reads the token from `?session=` (query) or a `session`
 *     body field (some clients send it there), validates it, and rejects with
 *     `401` — not processing the command — on anything but `'valid'` (Req 2.5).
 *
 * Handlers are thin translators: all logic lives in {@link SessionService}.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { Container } from '../../composition/container.js';
import type { ResolvedConfig } from '../../composition/bootstrap.js';
import type {
  LoginResponse,
  SessionIsValidResponse,
} from '../../shared/index.js';
import { BadRequestError, UnauthorizedError } from '../errors.js';

/** Extract a candidate session token from `?session=` or a `session` body field. */
function extractSessionToken(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, unknown> | undefined;
  const fromQuery = query?.session;
  if (typeof fromQuery === 'string') {
    return fromQuery;
  }

  const body = request.body as Record<string, unknown> | undefined;
  const fromBody = body?.session;
  if (typeof fromBody === 'string') {
    return fromBody;
  }

  return undefined;
}

/**
 * Build a reusable preHandler that enforces a valid session on protected routes.
 * Rejects with `401` and stops the request (throwing before the handler runs, so
 * the command is not processed) on any non-`'valid'` verdict (Req 2.5).
 */
export function makeRequireSession(container: Container): preHandlerHookHandler {
  return async function requireSession(request: FastifyRequest): Promise<void> {
    const token = extractSessionToken(request);
    const verdict = await container.sessions.validate(token);
    if (verdict !== 'valid') {
      // Throwing short-circuits before the route handler executes, guaranteeing
      // the protected command is never processed (Req 2.5).
      throw new UnauthorizedError('Invalid or expired session token.');
    }
  };
}

/**
 * Register `/login.fcgi` and `/session_is_valid.fcgi` (both unprotected) on the
 * app. Uses the resolved admin credentials for the login check (Req 2.2).
 */
export function registerSessionRoutes(
  app: FastifyInstance,
  container: Container,
  resolved: ResolvedConfig,
): void {
  app.post(
    '/login.fcgi',
    async (request: FastifyRequest, reply: FastifyReply): Promise<LoginResponse> => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const login = body.login;
      const password = body.password;

      // 400 naming the missing field(s) (Req 2.3).
      const missing: string[] = [];
      if (typeof login !== 'string' || login === '') {
        missing.push('login');
      }
      if (typeof password !== 'string' || password === '') {
        missing.push('password');
      }
      if (missing.length > 0) {
        throw new BadRequestError(
          `Missing required field(s): ${missing.join(', ')}.`,
        );
      }

      // 401 on credential mismatch, no token returned (Req 2.2).
      if (login !== resolved.login || password !== resolved.password) {
        throw new UnauthorizedError('Authentication failed: invalid credentials.');
      }

      // Success: issue and return the session token (Req 2.1).
      const token = await container.sessions.issue();
      reply.type('application/json');
      return { session: token.token };
    },
  );

  app.post(
    '/session_is_valid.fcgi',
    async (request: FastifyRequest, reply: FastifyReply): Promise<SessionIsValidResponse> => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const session = typeof body.session === 'string' ? body.session : undefined;
      const verdict = await container.sessions.validate(session);
      reply.type('application/json');
      return { session_is_valid: verdict === 'valid' };
    },
  );
}
