/**
 * Control Panel API routes (task 13.1) — the emulator's own `/api` surface the
 * React panel calls, distinct from the `.fcgi` compatibility surface. These
 * routes do NOT require an emulator `.fcgi` session (Req 7.x).
 *
 *   - `GET  /api/identities`          → `UserRepository.list()`        (Req 7.3)
 *   - `POST /api/simulate/authorized` `{ userId }` → PushOutcome; `400` naming
 *     the missing identity when `userId` is absent (Req 6.1, 6.6)
 *   - `POST /api/simulate/denied`     → PushOutcome                    (Req 6.2)
 *   - `POST /api/simulate/keep-alive` → PushOutcome                    (Req 6.3)
 *
 * A simulate that fails after retries does NOT throw — the failure is carried in
 * the returned {@link PushOutcome} so the panel can surface the error while
 * keeping the developer's selection (Req 6.5). The only thrown path is the
 * authorized-without-identity precondition, mapped to `400` (Req 6.6).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Container } from '../../composition/container.js';
import type { PushOutcome, UserRecord } from '../../shared/index.js';
import { BadRequestError } from '../errors.js';

export function registerControlPanelRoutes(
  app: FastifyInstance,
  container: Container,
): void {
  app.get(
    '/api/identities',
    async (_request: FastifyRequest, reply: FastifyReply): Promise<UserRecord[]> => {
      const identities = await container.users.list();
      reply.type('application/json');
      return identities;
    },
  );

  app.post(
    '/api/simulate/authorized',
    async (request: FastifyRequest, reply: FastifyReply): Promise<PushOutcome> => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const rawUserId = body.userId;
      if (rawUserId === undefined || rawUserId === null || rawUserId === '') {
        // 400 naming the missing identity, no webhook dispatched (Req 6.6).
        throw new BadRequestError('An identity (userId) must be selected.');
      }
      const userId = Number(rawUserId);
      // SimulationService rejects an unknown/NaN identity with SimulationError,
      // mapped to 400 by the global handler (Req 6.6).
      const outcome = await container.simulation.simulateAuthorized(userId);
      reply.type('application/json');
      return outcome;
    },
  );

  app.post(
    '/api/simulate/denied',
    async (_request: FastifyRequest, reply: FastifyReply): Promise<PushOutcome> => {
      const outcome = await container.simulation.simulateDenied();
      reply.type('application/json');
      return outcome;
    },
  );

  app.post(
    '/api/simulate/keep-alive',
    async (_request: FastifyRequest, reply: FastifyReply): Promise<PushOutcome> => {
      const outcome = await container.simulation.forceKeepAlive();
      reply.type('application/json');
      return outcome;
    },
  );
}
