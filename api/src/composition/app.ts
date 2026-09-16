/**
 * Fastify application assembly (task 11.1) — the single cohesive place where the
 * whole HTTP layer is wired: body parsers, the inbound interception tap, every
 * route group, the SPA static serving, and the global error/404/405 handling.
 *
 * `buildApp(container, resolved)` returns a ready {@link FastifyInstance} but
 * does NOT call `listen()` (that is `main.ts`'s job, task 14.1). The design keeps
 * route handlers thin — all business logic stays in the services reachable
 * through the {@link Container}.
 *
 * Notable behaviors:
 *   - Body parsers tolerant of the device's habits: `application/json` is parsed
 *     leniently so a malformed JSON body yields a controlled `400` with an
 *     `error-description` (Req 1.4) instead of Fastify's default; and
 *     `application/x-www-form-urlencoded` is supported for
 *     `new_user_identified.fcgi`. Both parsers stash the RAW request body on the
 *     request so the interception tap records it even on 4xx.
 *   - A global inbound tap records `.fcgi` and `/api` requests via
 *     {@link InterceptionLogger.recordInbound} with method, path, an ISO-8601 ms
 *     timestamp, and the raw body — captured before validation so it survives a
 *     4xx (Req 8.1).
 *   - Known `.fcgi` paths get a catch-all for non-listed methods returning `405`
 *     (Req 1.6); unknown paths fall through to the `404` handler (Req 1.5).
 *
 * See design.md → "Architecture", "API / Endpoint Specification", "Error
 * Handling".
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Container } from './container.js';
import type { ResolvedConfig } from './bootstrap.js';
import { installErrorHandlers } from '../routes/errors.js';
import {
  makeRequireSession,
  registerSessionRoutes,
} from '../routes/fcgi/session-routes.js';
import { registerConfigRoutes } from '../routes/fcgi/config-routes.js';
import { registerObjectRoutes } from '../routes/fcgi/object-routes.js';
import { registerControlPanelRoutes } from '../routes/control-panel/control-panel-routes.js';
import { registerInterceptionRoutes } from '../routes/interception/interception-routes.js';
import { registerAdminRoutes } from '../routes/admin/admin-routes.js';
import { registerStaticAssets } from '../routes/static.js';
import fastifyMultipart from '@fastify/multipart';
import { MAX_PHOTO_BYTES } from '../routes/photo-validation.js';

/** Symbol-free property name used to stash the raw request body for the tap. */
const RAW_BODY_KEY = 'rawBody';

/** Augment FastifyRequest with the raw-body stash written by the parsers. */
declare module 'fastify' {
  interface FastifyRequest {
    /** The raw request body string captured by the tolerant parsers. */
    [RAW_BODY_KEY]?: string;
  }
}

/** Options accepted by {@link buildApp}. */
export interface BuildAppOptions {
  /** Enable Fastify's pino logger (off by default; tests stay quiet). */
  logger?: boolean;
  /** Environment used for static-asset resolution (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

/**
 * The known `.fcgi` routes and the HTTP methods each supports. Used to produce a
 * `405` for a known path called with the wrong method (Req 1.6) while letting
 * genuinely unknown paths fall through to the `404` handler (Req 1.5).
 */
const KNOWN_FCGI_ROUTES: Record<string, ReadonlyArray<'GET' | 'POST'>> = {
  '/login.fcgi': ['POST'],
  '/session_is_valid.fcgi': ['POST'],
  '/set_configuration.fcgi': ['POST'],
  '/get_configuration.fcgi': ['POST'],
  '/create_objects.fcgi': ['POST'],
  '/load_objects.fcgi': ['POST'],
  '/modify_objects.fcgi': ['POST'],
  '/destroy_objects.fcgi': ['POST'],
  '/user_get_image.fcgi': ['GET', 'POST'],
  '/user_set_image.fcgi': ['POST'],
  '/user_destroy_image.fcgi': ['POST'],
  '/new_user_identified.fcgi': ['POST'],
};

/**
 * The methods we register an explicit `405` catch-all for on a known path when
 * that method is not among the path's allowed methods (Req 1.6). HEAD/OPTIONS
 * are intentionally excluded: Fastify auto-manages HEAD for GET routes (an
 * explicit HEAD would collide) and handles OPTIONS itself, so registering them
 * here would double-declare routes.
 */
const CATCHALL_METHODS: ReadonlyArray<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'> = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
];

/** True for paths whose bodies should be recorded by the inbound tap (Req 8.1). */
function isInterceptablePath(path: string): boolean {
  return path.endsWith('.fcgi') || path.startsWith('/api');
}

/** The path portion of a request URL (without the query string). */
function pathOf(request: FastifyRequest): string {
  const url = request.url;
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Build and configure the Fastify app. Registers parsers, the interception tap,
 * all routes, the SPA, and the error handlers. Does not listen.
 */
export async function buildApp(
  container: Container,
  resolved: ResolvedConfig,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  // --- Global plugins ---
  // Multipart capped at 5 MB / single file (Req 3.3).
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
    throwFileSizeLimit: true,
  });

  // --- Body parsers (raw-body-preserving, tolerant of malformed JSON). ---

  // application/json: capture the raw string and parse leniently. A malformed
  // body throws a 400-classified error rather than Fastify's default (Req 1.4).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, bodyString: string, done) => {
      request[RAW_BODY_KEY] = bodyString;
      const trimmed = bodyString.trim();
      if (trimmed === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(trimmed));
      } catch {
        const err = new Error('Request body is not valid JSON.') as Error & {
          statusCode?: number;
        };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  // application/x-www-form-urlencoded: for new_user_identified.fcgi (Req 1.1).
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (request, bodyString: string, done) => {
      request[RAW_BODY_KEY] = bodyString;
      const params = new URLSearchParams(bodyString);
      const parsed: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        parsed[key] = value;
      }
      done(null, parsed);
    },
  );

  // Fallback for any other content type: keep the raw body as a string so the
  // tap still records it; handlers that need it can parse further.
  app.addContentTypeParser(
    '*',
    { parseAs: 'string' },
    (request, bodyString: string, done) => {
      request[RAW_BODY_KEY] = bodyString;
      done(null, bodyString);
    },
  );

  // --- Inbound interception tap (Req 8.1). ---
  // onResponse fires for every request including 4xx/5xx, so the raw body is
  // recorded even on validation failure. The raw string was stashed by the
  // parser (present whenever a body was sent).
  app.addHook('onResponse', async (request) => {
    const path = pathOf(request);
    if (!isInterceptablePath(path)) {
      return;
    }
    try {
      await container.logger.recordInbound({
        method: request.method,
        path,
        body: request[RAW_BODY_KEY] ?? '',
        truncated: false,
        // timestamp omitted → logger generates ISO 8601 UTC ms (Req 8.1).
      });
    } catch {
      // Interception logging must never break the request lifecycle.
    }
  });

  // --- Global error + 404 handlers (Req 1.2, 1.4, 1.5). ---
  // IMPORTANT: these MUST be installed BEFORE any awaited `app.register(...)`
  // (e.g. `@fastify/static` below). In Fastify, awaiting a plugin registration
  // finalizes the current encapsulation context; a `setErrorHandler` /
  // `setNotFoundHandler` applied AFTER that boundary does not attach to routes
  // declared before it, so those routes silently fall back to Fastify's default
  // error serialization ({ statusCode, error, message }) — dropping the
  // `error-description` contract and mis-mapping domain errors to 500. Installing
  // the handlers here guarantees every route inherits the JSON error contract.
  installErrorHandlers(app);

  // --- Routes. ---
  const requireSession = makeRequireSession(container);
  registerSessionRoutes(app, container, resolved);
  registerConfigRoutes(app, container, requireSession);
  await registerObjectRoutes(app, container, resolved, requireSession);
  registerControlPanelRoutes(app, container);
  registerInterceptionRoutes(app, container);

  // --- 405 for known .fcgi paths called with an unsupported method (Req 1.6). ---
  for (const [path, allowed] of Object.entries(KNOWN_FCGI_ROUTES)) {
    for (const method of CATCHALL_METHODS) {
      if (allowed.includes(method as 'GET' | 'POST')) {
        continue;
      }
      app.route({
        method,
        url: path,
        handler: (_request, reply) => {
          reply
            .code(405)
            .header('allow', allowed.join(', '))
            .type('application/json')
            .send({
              'error-description': `Method ${method} not allowed for ${path}. Allowed: ${allowed.join(', ')}.`,
            });
        },
      });
    }
  }

  // --- Admin API (NEW): /api/admin/* (Req 10, 2–9, 13.2). ---
  // Registered AFTER the existing route registrations and the .fcgi 405
  // catch-alls (so those synchronous routes attach before this awaited plugin
  // registration finalizes the encapsulation context) and BEFORE the awaited
  // `registerStaticAssets` below — the error/404 handlers installed above still
  // apply. Reuses the SAME `requireSession` instance the app already built, and
  // registers `@fastify/multipart` (scoped) for the photo-upload endpoint.
  await registerAdminRoutes(app, container, requireSession);

  // --- SPA static serving at /admin (Req 7.1, 7.2). ---
  // Registered last: `@fastify/static` is an awaited plugin registration, and
  // the error/404 handlers were installed above so they apply to every route.
  await registerStaticAssets(app, options.env ?? process.env);

  await app.ready();
  return app;
}
