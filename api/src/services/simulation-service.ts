/**
 * SimulationService — builds correctly grounded webhook payloads for each
 * developer-initiated simulated access event and delegates dispatch to the
 * {@link PushEngine}.
 *
 * Behavior (Req 6.1–6.6, 4.1; design.md → "Components and Interfaces →
 * SimulationService", "Push / Webhook Payload Catalog", "Error Handling"):
 *
 *   - `simulateAuthorized(userId)` (Req 6.1): rejects with a {@link SimulationError}
 *     when `userId` is absent/NaN or does not correspond to an existing user, so
 *     NO webhook is dispatched (Req 6.6). Otherwise it appends an `access_logs`
 *     record (event `7`, granted) so subsequent `load_objects` queries reflect
 *     the event (Req 4.1), builds the `dao` envelope carrying that access-log
 *     record, and dispatches it to the `dao` endpoint.
 *   - `simulateDenied()` (Req 6.2): appends a denied (`event 6`, `user_id 0`)
 *     `access_logs` record and dispatches the same `dao` envelope shape.
 *   - `forceKeepAlive()` (Req 6.3): dispatches a `device_is_alive` envelope
 *     (`access_logs: 0`, the device id, and the current Unix-epoch-second time).
 *
 * A push failure after all retries is NOT thrown: it surfaces through the
 * returned {@link PushOutcome} (`success:false`), leaving the route/panel layer
 * to present the error while preserving the developer's selection (Req 6.5).
 * The ONLY thrown condition is the invalid-identity precondition (Req 6.6).
 *
 * This service orchestrates the repository and the push engine and builds
 * grounded payloads; it performs no HTTP-framework work.
 */
import type { PushEngine } from './push-engine.js';
import type { UserRepository } from '../repositories/user-repository.js';
import {
  ACCESS_EVENT,
  type AccessLogRecord,
  type DaoNotification,
  type DeviceIsAliveNotification,
  type PushOutcome,
} from '../shared/index.js';

/**
 * Thrown when a simulated authorized-access event is initiated without a valid
 * selected identity (Req 6.6). Signals the caller to present an error indicating
 * that an identity must be selected; no webhook is dispatched.
 */
export class SimulationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
    // Restore prototype chain for reliable `instanceof` across transpilation.
    Object.setPrototypeOf(this, SimulationError.prototype);
  }
}

/** Dependencies required to construct a {@link SimulationService}. */
export interface SimulationServiceDeps {
  /** The push engine used to dispatch webhooks. */
  pushEngine: PushEngine;
  /** Repository used to validate identities and append access logs. */
  users: UserRepository;
  /** Synthetic device id used in payloads (numeric at the envelope level). */
  deviceId: number;
  /** Injectable clock (epoch ms) for deterministic timestamps; defaults to `Date.now`. */
  now?: () => number;
}

export class SimulationService {
  private readonly pushEngine: PushEngine;
  private readonly users: UserRepository;
  private readonly deviceId: number;
  private readonly now: () => number;

  public constructor(deps: SimulationServiceDeps) {
    this.pushEngine = deps.pushEngine;
    this.users = deps.users;
    this.deviceId = deps.deviceId;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Simulate an authorized-access event for `userId` (Req 6.1).
   *
   * Rejects with a {@link SimulationError} — dispatching NO webhook (Req 6.6) —
   * when `userId` is null/undefined/NaN or does not match an existing user.
   * Otherwise appends a granted (`event 7`) `access_logs` record (Req 4.1),
   * builds the `dao` envelope carrying that record, dispatches it to `dao`, and
   * returns the resulting {@link PushOutcome} (a push failure surfaces via the
   * outcome rather than throwing, Req 6.5).
   */
  public async simulateAuthorized(userId: number): Promise<PushOutcome> {
    if (userId === null || userId === undefined || Number.isNaN(userId)) {
      throw new SimulationError(
        'An identity must be selected to simulate an authorized access event.',
      );
    }

    const users = await this.users.list();
    const exists = users.some((user) => user.id === userId);
    if (!exists) {
      throw new SimulationError(
        `No identity exists for the selected user id ${String(userId)}.`,
      );
    }

    const record = await this.users.appendAccessLog({
      event: String(ACCESS_EVENT.granted),
      device_id: String(this.deviceId),
      user_id: String(userId),
    });

    return this.pushEngine.dispatch('dao', this.buildDaoNotification(record));
  }

  /**
   * Simulate a denied-access event (Req 6.2). Appends a denied (`event 6`,
   * `user_id 0`) `access_logs` record (Req 4.1), builds the `dao` envelope, and
   * dispatches it to `dao`. Returns the resulting {@link PushOutcome}.
   */
  public async simulateDenied(): Promise<PushOutcome> {
    const record = await this.users.appendAccessLog({
      event: String(ACCESS_EVENT.denied),
      device_id: String(this.deviceId),
      user_id: '0',
    });

    return this.pushEngine.dispatch('dao', this.buildDaoNotification(record));
  }

  /**
   * Simulate a keep-alive event (Req 6.3). Dispatches a `device_is_alive`
   * envelope with `access_logs: 0`, the device id, and the current time in
   * Unix-epoch seconds. Returns the resulting {@link PushOutcome}.
   */
  public async forceKeepAlive(): Promise<PushOutcome> {
    const payload: DeviceIsAliveNotification = {
      access_logs: 0,
      device_id: this.deviceId,
      time: Math.floor(this.now() / 1000),
    };

    return this.pushEngine.dispatch('device_is_alive', payload);
  }

  /**
   * Build a `dao` webhook envelope carrying a single inserted `access_logs`
   * record. The nested `values.device_id` is a string (device wire shape) while
   * the envelope-level `device_id` is numeric.
   */
  private buildDaoNotification(record: AccessLogRecord): DaoNotification {
    return {
      object_changes: [
        {
          object: 'access_logs',
          type: 'inserted',
          values: record,
        },
      ],
      device_id: this.deviceId,
    };
  }
}
