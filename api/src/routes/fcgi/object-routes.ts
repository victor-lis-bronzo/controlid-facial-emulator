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
export function registerObjectRoutes(
  app: FastifyInstance,
  container: Container,
  resolved: ResolvedConfig,
  requireSession: preHandlerHookHandler,
): void {
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
    if (rawUserId === undefined || rawUserId === '') {
      throw new BadRequestError("Missing required parameter: 'user_id'.");
    }
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestError("Parameter 'user_id' must be a positive integer.");
    }

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
