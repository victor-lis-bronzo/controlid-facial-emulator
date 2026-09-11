/**
 * Interception API route (task 13.1) — the panel's read view over the
 * interception log. Does NOT require a `.fcgi` session.
 *
 *   - `GET /api/interception?limit=<n>` → `InterceptionRecord[]`, newest-first
 *     (Req 8.5); an empty array when no records exist (Req 8.6 empty-state).
 *
 * A thin translator over {@link InterceptionLogger.query}, which already orders
 * by `id DESC`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Container } from '../../composition/container.js';
import type { InterceptionRecord } from '../../shared/index.js';
import { BadRequestError } from '../errors.js';

export function registerInterceptionRoutes(
  app: FastifyInstance,
  container: Container,
): void {
  app.get(
    '/api/interception',
    async (request: FastifyRequest, reply: FastifyReply): Promise<InterceptionRecord[]> => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      let limit: number | undefined;
      if (query.limit !== undefined && query.limit !== '') {
        const parsed = Number(query.limit);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new BadRequestError("Query parameter 'limit' must be a non-negative integer.");
        }
        limit = parsed;
      }
      // Newest-first (Req 8.5); [] when none (Req 8.6).
      const records = await container.logger.query(limit);
      reply.type('application/json');
      return records;
    },
  );
}
