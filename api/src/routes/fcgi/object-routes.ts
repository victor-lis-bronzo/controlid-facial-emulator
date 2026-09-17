/**
 * Object / log / biometry `.fcgi` routes (task 12.3).
 *
 * Registers the Control-iD object-model endpoints plus the image and
 * online-identification callback, delegating to {@link ObjectStore} /
 * {@link UserRepository}. Exact request/response shapes come from the design's
 * API/Endpoint Specification (Req 1.1, 1.2, 4.1–4.5).
 *
 *   - `POST /create_objects.fcgi`  → `{ ids }`                       (Req 4.1)
 *   - `POST /load_objects.fcgi`    → `{ [object]: rows }` (empty `[]` when none;
 *                                     bad filter → 400 naming param, Req 4.2/4.4/4.5)
 *   - `POST /modify_objects.fcgi`  → `{ changes }`
 *   - `POST /destroy_objects.fcgi` → `{ changes }`
 *   - `GET|POST /user_get_image.fcgi?user_id=` → octet-stream bytes, or `404`
 *     with `error-description` when the user has no stored image (documented
 *     choice: the emulator ships no image bytes, so this returns 404; see the
 *     UserRepository stub note).
 *   - `POST /user_set_image.fcgi` (multipart/form-data, `user_id` in query or
 *     as a form field, file part named `file`) → `{ success: true }`; `400` for
 *     a missing/invalid `user_id`, missing file part, disallowed declared MIME,
 *     or a magic-byte mismatch; `413` over the 5 MB cap; `404` for an unknown
 *     `user_id` (Issue #26).
 *   - `POST /user_destroy_image.fcgi` (`user_id` in query or body) →
 *     `{ success: true }`; `400`/`404` as above (Issue #26).
 *   - `POST /new_user_identified.fcgi` (x-www-form-urlencoded, unprotected —
 *     models the device→server callback): parses the form fields and returns the
 *     "Mensagem de Retorno" `{ result: {...} }`, echoing user_id/user_name.
 *
 * All object routes are protected by the shared `requireSession` preHandler.
 * The image route is protected; `new_user_identified` is unprotected (it models
 * the device's own callback to a server).
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { Container } from '../../composition/container.js';
import type { ResolvedConfig } from '../../composition/bootstrap.js';
import {
  ACCESS_EVENT,
  type AccessEvent,
  type CreateObjectsResponse,
  type DestroyObjectsResponse,
  type LoadObjectsResponse,
  type ModifyObjectsResponse,
  type NewUserIdentifiedResponse,
} from '../../shared/index.js';
import { BadRequestError, HttpError } from '../errors.js';
import {
  ACCEPTED_FORMATS_MESSAGE,
  ACCEPTED_MIMES,
  isFileTooLargeError,
  sniffImageMime,
} from '../photo-validation.js';

/** Parse a `user_id` value (from query or body) as a positive integer, or throw `400`. */
function parseUserId(rawUserId: unknown): number {
  if (rawUserId === undefined || rawUserId === '') {
    throw new BadRequestError("Missing required parameter: 'user_id'.");
  }
  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new BadRequestError("Parameter 'user_id' must be a positive integer.");
  }
  return userId;
}

/** Require and return a non-empty string `object` field, or throw `400`. */
function requireObject(body: Record<string, unknown>): string {
  const object = body.object;
  if (typeof object !== 'string' || object === '') {
    throw new BadRequestError("Missing or invalid required field: 'object'.");
  }
  return object;
}

/** Coerce a possibly-missing filter/values/where map to a plain object or throw `400`. */
function requireObjectMap(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || value === undefined) {
    throw new BadRequestError(`Missing required field: '${field}'.`);
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError(`Field '${field}' must be an object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Register the object/log/biometry routes. `requireSession` guards every route
 * except `new_user_identified` (the device callback).
 */
export async function registerObjectRoutes(
  app: FastifyInstance,
  container: Container,
  resolved: ResolvedConfig,
  requireSession: preHandlerHookHandler,
): Promise<void> {
  app.post(
    '/create_objects.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<CreateObjectsResponse> => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const object = requireObject(body);
      const values = body.values;
      if (!Array.isArray(values)) {
        throw new BadRequestError("Field 'values' must be an array of records.");
      }
      const result = await container.objectStore.create(
        object,
        values as Record<string, unknown>[],
      );
      reply.type('application/json');
      return { ids: result.ids };
    },
  );

  app.post(
    '/load_objects.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<LoadObjectsResponse> => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const object = requireObject(body);
      const where =
        body.where === undefined
          ? undefined
          : requireObjectMap(body.where, 'where');
      // Unrecognized filter keys throw a repo ValidationError → 400 (Req 4.5).
      const rows = await container.objectStore.load(object, where);
      reply.type('application/json');
      // Keyed by object name; empty collection when none match (Req 4.2).
      return { [object]: rows };
    },
  );

  app.post(
    '/modify_objects.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<ModifyObjectsResponse> => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const object = requireObject(body);
      const values = requireObjectMap(body.values, 'values');
      const where = requireObjectMap(body.where, 'where');
      const result = await container.objectStore.modify(object, values, where);
      reply.type('application/json');
      return { changes: result.changes };
    },
  );

  app.post(
    '/destroy_objects.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<DestroyObjectsResponse> => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const object = requireObject(body);
      const where = requireObjectMap(body.where, 'where');

      if (object === 'users') {
        const matchingUsers = await container.objectStore.load('users', where);
        for (const u of matchingUsers) {
          if (typeof u.id === 'number') {
            await container.photos.delete(u.id);
          }
        }
      }

      const result = await container.objectStore.destroy(object, where);
      reply.type('application/json');
      return { changes: result.changes };
    },
  );

  // GET or POST: user_id comes from the query (GET) or body (POST).
  const userGetImageHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Buffer> => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawUserId =
      query.user_id !== undefined ? query.user_id : body.user_id;
    const userId = parseUserId(rawUserId);

    const image = await container.users.getImageWithMime(userId);
    if (image === null) {
      // Documented choice: no stored image → 404 with error-description rather
      // than an ambiguous empty 200 body.
      throw new HttpError(404, `No image stored for user_id ${String(userId)}.`);
    }
    // Serve the stored bytes with a content type matching the stored image
    // format (image/jpeg or image/png) so the browser/avatar renders it
    // correctly (Req 3.5). Route shape and auth are unchanged.
    reply.type(image.mime);
    return image.bytes;
  };

  app.get('/user_get_image.fcgi', { preHandler: requireSession }, userGetImageHandler);
  app.post('/user_get_image.fcgi', { preHandler: requireSession }, userGetImageHandler);

  app.post(
    '/user_set_image.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<{ success: true }> => {
      const part = await request.file();
      if (part === undefined) {
        throw new BadRequestError('Missing file part in multipart upload.');
      }

      // `request.file()` consumes the whole multipart stream, so any plain
      // text fields (like `user_id`) sent alongside the file are available on
      // `part.fields`. A `user_id` query param takes precedence when present.
      const query = (request.query ?? {}) as Record<string, unknown>;
      const fields = part.fields as Record<string, { value?: unknown } | undefined>;
      const rawUserId =
        query.user_id !== undefined ? query.user_id : fields.user_id?.value;
      const userId = parseUserId(rawUserId);

      // Reject an unacceptable declared MIME up front. We still sniff the
      // bytes below to defend against a spoofed content type.
      if (!ACCEPTED_MIMES.has(part.mimetype)) {
        throw new BadRequestError(ACCEPTED_FORMATS_MESSAGE);
      }

      // Buffer the part. When it exceeds the 5 MB cap the plugin throws
      // FST_REQ_FILE_TOO_LARGE (413).
      let bytes: Buffer;
      try {
        bytes = await part.toBuffer();
      } catch (error) {
        if (isFileTooLargeError(error)) {
          throw new HttpError(413, 'Facial photo must not exceed 5 MB.');
        }
        throw error;
      }

      // Sniff magic bytes; a mismatch → 400 and nothing is written.
      const sniffed = sniffImageMime(bytes);
      if (sniffed === null) {
        throw new BadRequestError(ACCEPTED_FORMATS_MESSAGE);
      }

      // Confirm the user exists (404 otherwise) then store.
      await container.userAdmin.setPhoto(userId, bytes, sniffed);
      reply.type('application/json');
      return { success: true };
    },
  );

  app.post(
    '/user_destroy_image.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<{ success: true }> => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const rawUserId =
        query.user_id !== undefined ? query.user_id : body.user_id;
      const userId = parseUserId(rawUserId);

      await container.userAdmin.deletePhoto(userId);
      reply.type('application/json');
      return { success: true };
    },
  );

  // Device→server online-identification callback ("Mensagem de Retorno").
  // Unprotected: it models a call the device makes TO a server, so it does not
  // require the emulator's own session. Accepts x-www-form-urlencoded fields.
  app.post(
    '/new_user_identified.fcgi',
    async (request: FastifyRequest, reply: FastifyReply): Promise<NewUserIdentifiedResponse> => {
      const form = (request.body ?? {}) as Record<string, unknown>;

      const eventRaw = form.event;
      const parsedEvent =
        eventRaw === undefined || eventRaw === '' ? undefined : Number(eventRaw);
      const event: AccessEvent =
        parsedEvent === ACCESS_EVENT.denied
          ? ACCESS_EVENT.denied
          : parsedEvent === ACCESS_EVENT.not_identified
            ? ACCESS_EVENT.not_identified
            : ACCESS_EVENT.granted;

      const userIdRaw = form.user_id;
      const userId =
        userIdRaw === undefined || userIdRaw === ''
          ? 0
          : Number(userIdRaw);
      const userName =
        typeof form.user_name === 'string' ? form.user_name : '';
      const portalIdRaw = form.portal_id;
      const portalId =
        portalIdRaw === undefined || portalIdRaw === ''
          ? 1
          : Number(portalIdRaw);

      reply.type('application/json');
      // Build a granted reply echoing the identity when provided. The device
      // returns a `door` action to release the door for a granted event.
      return {
        result: {
          event,
          user_id: Number.isNaN(userId) ? 0 : userId,
          user_name: userName,
          user_image: false,
          portal_id: Number.isNaN(portalId) ? 1 : portalId,
          actions:
            event === ACCESS_EVENT.granted
              ? [{ action: 'door', parameters: 'door=1' }]
              : [],
          message:
            event === ACCESS_EVENT.granted
              ? `Access granted for ${resolved.login === '' ? 'user' : userName || 'user'}.`
              : 'Access denied.',
        },
      };
    },
  );
}
