/**
 * Admin API route registration (tasks 7.1–7.7, 9.1, 9.2).
 *
 * `registerAdminRoutes(app, container, requireSession)` is the single wiring
 * point for the whole `/api/admin` surface. It is called from `buildApp`
 * (`app.ts`) AFTER the existing route registrations and BEFORE the awaited
 * `registerStaticAssets`, so the error/404 handlers already installed there
 * apply to every admin route (the `{ "error-description": ... }` contract and
 * the domain-error → status mapping in `classify()`).
 *
 * Design contract (design.md → "Admin API Endpoint Specification", "Photo Upload
 * & Retrieval", "Error Handling"):
 *   - Base path `/api/admin`; JSON bodies except photo upload (`multipart/form-data`).
 *   - Reads (GET) are open (Req 10.3); mutations (POST/PUT/DELETE) attach the
 *     shared `requireSession` preHandler → `401` on absent/expired token
 *     (Req 10.2, 10.4).
 *   - Handlers are THIN translators: they parse HTTP, delegate to the container
 *     service, and shape the response. All validation and referential integrity
 *     live in the services, which throw the shared domain errors.
 *   - Status codes: `201` create, `200` read/update/delete; `400/401/404/409/413`
 *     surface from the services / multipart plugin via the global error handler.
 *
 * `@fastify/multipart` is registered here (scoped) with a 5 MB single-file limit
 * so the oversize case yields `413` (Req 3.3); `throwFileSizeLimit` makes
 * `toBuffer()` raise `FST_REQ_FILE_TOO_LARGE` (a 413 `FastifyError`) rather than
 * silently truncating.
 */
import fastifyMultipart from '@fastify/multipart';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { Container } from '../../composition/container.js';
import type { PhotoMime } from '../../repositories/photo-storage.js';
import type { TimeRangeWrite } from '../../repositories/time-zone-repository.js';
import type { AccessLogFilter } from '../../repositories/access-log-repository.js';
import { BadRequestError, HttpError } from '../errors.js';

/** Maximum accepted facial-photo size in bytes (5 MB) (Req 3.1, 3.3). */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The two accepted image MIME types (Req 3.2). */
const ACCEPTED_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/** Human-readable list of accepted photo formats, used in the 400 message. */
const ACCEPTED_FORMATS_MESSAGE = 'Accepted formats: JPEG, PNG.';

/**
 * Parse and validate a `:id` route param as a positive integer, throwing a
 * `400` naming `id` when it is not (Req: `:id` params validated as positive
 * integers → 400 naming `id`).
 */
function parseIdParam(request: FastifyRequest): number {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const raw = params.id;
  const id = Number(raw);
  if (typeof raw !== 'string' || raw.trim() === '' || !Number.isInteger(id) || id <= 0) {
    throw new BadRequestError("Parameter 'id' must be a positive integer.");
  }
  return id;
}

/** Read the request body as a plain record (JSON bodies are already parsed). */
function bodyOf(request: FastifyRequest): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
}

/**
 * Coerce a submitted value to a `number[]`, throwing a `400` naming the field
 * when it is neither absent nor an array of integers. `undefined` maps to `[]`
 * so callers can treat an omitted set uniformly; the services enforce
 * non-empty/existence rules.
 */
function toIdArray(value: unknown, field: string): number[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestError(`Field "${field}" must be an array of ids.`);
  }
  return value.map((entry) => {
    const n = Number(entry);
    if (!Number.isInteger(n)) {
      throw new BadRequestError(`Field "${field}" must contain only integer ids.`);
    }
    return n;
  });
}

/**
 * Coerce a submitted `timeRanges` value into the repository's
 * {@link TimeRangeWrite}[] shape. Structural coercion only; the
 * `TimeZoneService` performs the `HH:MM` / `start < end` / weekday validation
 * (Req 5.2–5.4).
 */
function toTimeRanges(value: unknown): TimeRangeWrite[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestError('Field "timeRanges" must be an array.');
  }
  return value.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const days = Array.isArray(record.days) ? (record.days as unknown[]).map(String) : [];
    return {
      days,
      startTime: typeof record.startTime === 'string' ? record.startTime : '',
      endTime: typeof record.endTime === 'string' ? record.endTime : '',
    };
  });
}

/**
 * Sniff the leading magic bytes to confirm the declared image type, returning
 * the detected MIME or `null` when the bytes match neither JPEG nor PNG. This
 * defends against a spoofed `mimetype` (Req 3.2).
 *
 *   - JPEG: `FF D8 FF`
 *   - PNG:  `89 50 4E 47`
 */
function sniffImageMime(bytes: Buffer): PhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  return null;
}

/** True for a thrown value carrying the multipart oversize error code. */
function isFileTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

/**
 * Parse an access-log filter parameter that is either an ISO-8601 date string
 * or epoch seconds, returning epoch seconds. Throws a `400` naming the parameter
 * on an unparseable value (Req 8.6).
 */
function parseTimeParam(value: string, param: string): number {
  const trimmed = value.trim();
  // Pure integer / decimal → treat as epoch seconds.
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new BadRequestError(`Invalid value for parameter '${param}'.`);
  }
  return Math.floor(ms / 1000);
}

/**
 * Register the `/api/admin` surface. Reads attach no session; every mutation
 * attaches the shared `requireSession` preHandler produced by
 * `makeRequireSession(container)` in `app.ts` (Req 10.2, 10.3).
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  container: Container,
  requireSession: preHandlerHookHandler,
): Promise<void> {
  // Multipart, scoped to this registration, capped at 5 MB / single file. The
  // `throwFileSizeLimit` flag makes `toBuffer()` raise FST_REQ_FILE_TOO_LARGE
  // (a 413 FastifyError) when the part exceeds the cap (Req 3.3).
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
    throwFileSizeLimit: true,
  });

  registerUserRoutes(app, container, requireSession);
  registerGroupRoutes(app, container, requireSession);
  registerPortalRoutes(app, container, requireSession);
  registerTimeZoneRoutes(app, container, requireSession);
  registerAccessRuleRoutes(app, container, requireSession);
  registerAccessLogRoutes(app, container);
  registerDashboardRoutes(app, container);
}

// ---------------------------------------------------------------------------
// Task 7.2 / 7.3 — Users (JSON CRUD) + photo (multipart)
// ---------------------------------------------------------------------------

function registerUserRoutes(
  app: FastifyInstance,
  container: Container,
  requireSession: preHandlerHookHandler,
): void {
  // GET /api/admin/users — open list (Req 2.4).
  app.get('/api/admin/users', async (_request, reply) => {
    reply.type('application/json');
    return container.userAdmin.list();
  });

  // POST /api/admin/users — create → 201 (Req 2.1).
  app.post(
    '/api/admin/users',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = bodyOf(request);
      const view = await container.userAdmin.create({
        registration: body.registration as string,
        name: body.name as string,
        pin: typeof body.pin === 'string' ? body.pin : undefined,
        groupIds: toIdArray(body.groupIds, 'groupIds'),
      });
      reply.code(201).type('application/json');
      return view;
    },
  );

  // GET /api/admin/users/:id — open read (Req 2.5, 2.6).
  app.get('/api/admin/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = parseIdParam(request);
    reply.type('application/json');
    return container.userAdmin.get(id);
  });

  // PUT /api/admin/users/:id — update → 200 (Req 2.7).
  app.put(
    '/api/admin/users/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      const body = bodyOf(request);
      const view = await container.userAdmin.update(id, {
        registration: body.registration as string,
        name: body.name as string,
        pin: typeof body.pin === 'string' ? body.pin : undefined,
        groupIds: toIdArray(body.groupIds, 'groupIds'),
      });
      reply.type('application/json');
      return view;
    },
  );

  // DELETE /api/admin/users/:id — delete → 200 (Req 2.8).
  app.delete(
    '/api/admin/users/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      await container.userAdmin.delete(id);
      reply.type('application/json');
      return { deleted: true };
    },
  );

  // POST /api/admin/users/:id/photo — multipart upload (Req 3.1, 3.2, 3.3).
  app.post(
    '/api/admin/users/:id/photo',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);

      const part = await request.file();
      if (part === undefined) {
        throw new BadRequestError('Missing file part in multipart upload.');
      }

      // Reject an unacceptable declared MIME up front (Req 3.2). We still sniff
      // the bytes below to defend against a spoofed content type.
      if (!ACCEPTED_MIMES.has(part.mimetype)) {
        throw new BadRequestError(ACCEPTED_FORMATS_MESSAGE);
      }

      // Buffer the part. When it exceeds the 5 MB cap the plugin throws
      // FST_REQ_FILE_TOO_LARGE (413); attach the explicit size message (Req 3.3).
      let bytes: Buffer;
      try {
        bytes = await part.toBuffer();
      } catch (error) {
        if (isFileTooLargeError(error)) {
          // 413 with the explicit size message (Req 3.3). `classify()` honors
          // any HttpError's statusCode via its instanceof fast path.
          throw new HttpError(413, 'Facial photo must not exceed 5 MB.');
        }
        throw error;
      }

      // Sniff magic bytes; a mismatch → 400 and nothing is written (Req 3.2).
      const sniffed = sniffImageMime(bytes);
      if (sniffed === null) {
        throw new BadRequestError(ACCEPTED_FORMATS_MESSAGE);
      }

      // Confirm the user exists (404 otherwise, Req 2.6) then store (Req 3.1).
      await container.userAdmin.setPhoto(id, bytes, sniffed);
      reply.type('application/json');
      return { hasPhoto: true };
    },
  );

  // DELETE /api/admin/users/:id/photo — clear the photo → 200 (Req 3.6).
  app.delete(
    '/api/admin/users/:id/photo',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      await container.userAdmin.deletePhoto(id);
      reply.type('application/json');
      return { hasPhoto: false };
    },
  );
}

// ---------------------------------------------------------------------------
// Task 7.4 — Groups
// ---------------------------------------------------------------------------

function registerGroupRoutes(
  app: FastifyInstance,
  container: Container,
  requireSession: preHandlerHookHandler,
): void {
  app.get('/api/admin/groups', async (_request, reply) => {
    reply.type('application/json');
    return container.groups.list();
  });

  app.post(
    '/api/admin/groups',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = bodyOf(request);
      const detail = await container.groups.create(body.name);
      reply.code(201).type('application/json');
      return detail;
    },
  );

  app.get('/api/admin/groups/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = parseIdParam(request);
    reply.type('application/json');
    return container.groups.get(id);
  });

  app.put(
    '/api/admin/groups/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      const body = bodyOf(request);
      const detail = await container.groups.update(
        id,
        body.name,
        toIdArray(body.memberIds, 'memberIds'),
      );
      reply.type('application/json');
      return detail;
    },
  );

  app.delete(
    '/api/admin/groups/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      await container.groups.delete(id);
      reply.type('application/json');
      return { deleted: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Task 7.5 — Portals
// ---------------------------------------------------------------------------

function registerPortalRoutes(
  app: FastifyInstance,
  container: Container,
  requireSession: preHandlerHookHandler,
): void {
  app.get('/api/admin/portals', async (_request, reply) => {
    reply.type('application/json');
    return container.portals.list();
  });

  app.post(
    '/api/admin/portals',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = bodyOf(request);
      const view = await container.portals.create(body.name);
      reply.code(201).type('application/json');
      return view;
    },
  );

  app.get('/api/admin/portals/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = parseIdParam(request);
    reply.type('application/json');
    return container.portals.get(id);
  });

  app.put(
    '/api/admin/portals/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      const body = bodyOf(request);
      const view = await container.portals.update(id, body.name);
      reply.type('application/json');
      return view;
    },
  );

  app.delete(
    '/api/admin/portals/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      await container.portals.delete(id);
      reply.type('application/json');
      return { deleted: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Task 7.6 — Time Zones
// ---------------------------------------------------------------------------

function registerTimeZoneRoutes(
  app: FastifyInstance,
  container: Container,
  requireSession: preHandlerHookHandler,
): void {
  app.get('/api/admin/time-zones', async (_request, reply) => {
    reply.type('application/json');
    return container.timeZones.list();
  });

  app.post(
    '/api/admin/time-zones',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = bodyOf(request);
      const view = await container.timeZones.create(body.name, toTimeRanges(body.timeRanges));
      reply.code(201).type('application/json');
      return view;
    },
  );

  app.get('/api/admin/time-zones/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = parseIdParam(request);
    reply.type('application/json');
    return container.timeZones.get(id);
  });

  app.put(
    '/api/admin/time-zones/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      const body = bodyOf(request);
      const view = await container.timeZones.update(
        id,
        body.name,
        toTimeRanges(body.timeRanges),
      );
      reply.type('application/json');
      return view;
    },
  );

  app.delete(
    '/api/admin/time-zones/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      await container.timeZones.delete(id);
      reply.type('application/json');
      return { deleted: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Task 7.7 — Access Rules
// ---------------------------------------------------------------------------

function registerAccessRuleRoutes(
  app: FastifyInstance,
  container: Container,
  requireSession: preHandlerHookHandler,
): void {
  app.get('/api/admin/access-rules', async (_request, reply) => {
    reply.type('application/json');
    return container.accessRules.list();
  });

  app.post(
    '/api/admin/access-rules',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = bodyOf(request);
      const view = await container.accessRules.create({
        name: body.name as string,
        groupIds: toIdArray(body.groupIds, 'groupIds'),
        timeZoneIds: toIdArray(body.timeZoneIds, 'timeZoneIds'),
        portalIds: toIdArray(body.portalIds, 'portalIds'),
      });
      reply.code(201).type('application/json');
      return view;
    },
  );

  app.get(
    '/api/admin/access-rules/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      reply.type('application/json');
      return container.accessRules.get(id);
    },
  );

  app.put(
    '/api/admin/access-rules/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      const body = bodyOf(request);
      const view = await container.accessRules.update(id, {
        name: body.name as string,
        groupIds: toIdArray(body.groupIds, 'groupIds'),
        timeZoneIds: toIdArray(body.timeZoneIds, 'timeZoneIds'),
        portalIds: toIdArray(body.portalIds, 'portalIds'),
      });
      reply.type('application/json');
      return view;
    },
  );

  app.delete(
    '/api/admin/access-rules/:id',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = parseIdParam(request);
      await container.accessRules.delete(id);
      reply.type('application/json');
      return { deleted: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Task 9.1 — Access Logs (open read, filterable)
// ---------------------------------------------------------------------------

function registerAccessLogRoutes(app: FastifyInstance, container: Container): void {
  // GET /api/admin/access-logs?user_id=&event=&from=&to= (all optional).
  app.get('/api/admin/access-logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const filter: AccessLogFilter = {};

    const userId = query.user_id;
    if (typeof userId === 'string' && userId !== '') {
      filter.userId = userId;
    }
    const event = query.event;
    if (typeof event === 'string' && event !== '') {
      filter.event = event;
    }
    const from = query.from;
    if (typeof from === 'string' && from !== '') {
      filter.from = parseTimeParam(from, 'from');
    }
    const to = query.to;
    if (typeof to === 'string' && to !== '') {
      filter.to = parseTimeParam(to, 'to');
    }

    reply.type('application/json');
    return container.accessLogs.query(filter);
  });
}

// ---------------------------------------------------------------------------
// Task 9.2 — Dashboard (open read)
// ---------------------------------------------------------------------------

function registerDashboardRoutes(app: FastifyInstance, container: Container): void {
  app.get('/api/admin/dashboard', async (_request, reply) => {
    reply.type('application/json');
    return container.dashboard.load();
  });
}
