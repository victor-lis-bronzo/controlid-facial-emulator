/**
 * Configuration `.fcgi` routes (task 12.2) — both protected by a valid session.
 *
 *   - `POST /set_configuration.fcgi` (Req 3.1, 3.2): delegates the request body
 *     (a module→patch map) to {@link ConfigService.set}, which validates
 *     all-or-nothing and throws a `ValidationError` naming the rejected key on
 *     failure (mapped to `400` + `error-description` by the global error
 *     handler). Success returns `{}`.
 *   - `POST /get_configuration.fcgi` (Req 3.3, 3.4): the body maps module →
 *     `string[]` of keys; returns each requested module's values as the device
 *     does — stringified (the device returns config values as strings).
 *
 * Handlers are thin translators over {@link ConfigService}.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Container } from '../../composition/container.js';
import type {
  GetConfigurationResponse,
  SetConfigurationResponse,
  ConfigPatch,
} from '../../shared/index.js';
import { BadRequestError } from '../errors.js';

/**
 * Stringify a configuration value the way the device returns it over the wire:
 * primitives become their string form; objects/arrays are JSON-encoded.
 */
function stringifyConfigValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Register the configuration routes on the app. Both are guarded by the shared
 * `requireSession` preHandler (Req 2.5).
 */
export function registerConfigRoutes(
  app: FastifyInstance,
  container: Container,
  requireSession: preHandlerHookHandler,
): void {
  app.post(
    '/set_configuration.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<SetConfigurationResponse> => {
      const body = request.body as unknown;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new BadRequestError(
          'set_configuration requires a JSON object mapping modules to values.',
        );
      }

      // Some clients pass the session token in the body; strip it so it is not
      // treated as a configuration module by ConfigService.set.
      const { session: _session, ...patch } = body as Record<string, unknown>;
      void _session;

      // ConfigService.set validates all-or-nothing and throws ValidationError
      // (→ 400 naming the rejected key) when anything is invalid (Req 3.2).
      await container.config.set(patch as ConfigPatch);

      reply.type('application/json');
      return {};
    },
  );

  app.post(
    '/get_configuration.fcgi',
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply): Promise<GetConfigurationResponse> => {
      const body = request.body as unknown;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new BadRequestError(
          'get_configuration requires a JSON object mapping modules to key lists.',
        );
      }

      const requested = body as Record<string, unknown>;
      const response: GetConfigurationResponse = {};

      for (const [module, keys] of Object.entries(requested)) {
        // Some clients pass the session token in the body; it is consumed by the
        // session guard and is not a configuration module.
        if (module === 'session') {
          continue;
        }
        if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
          throw new BadRequestError(
            `get_configuration expects an array of key names for module '${module}'.`,
          );
        }
        // ConfigService.get fills documented defaults for unset keys (Req 3.4)
        // and throws ValidationError (→ 400) for an unrecognized module.
        const values = await container.config.get(module, keys as string[]);
        const stringified: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
          stringified[key] = stringifyConfigValue(value);
        }
        response[module] = stringified;
      }

      reply.type('application/json');
      return response;
    },
  );
}
