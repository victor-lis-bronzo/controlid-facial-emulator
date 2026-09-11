/**
 * Repository-layer error types for the Control-iD Facial Emulator.
 *
 * `ValidationError` signals a rejected/unrecognized filter parameter or an
 * unknown object type when reading/writing the object model (Req 4.5). It
 * carries the offending parameter name so callers (e.g. the `.fcgi` route
 * layer) can surface an `error-description` naming the invalid parameter.
 *
 * NOTE: This is intentionally a repository-local `ValidationError`, distinct
 * from any `ValidationError` defined under `services/`. The two are authored in
 * parallel; a later refactor can unify them into a single shared error. This
 * module must NOT import from `services/` to avoid a cross-task dependency.
 */

/**
 * Thrown when a request references an unknown object type or supplies a filter
 * parameter that is not a recognized column for the target object (Req 4.5).
 */
export class ValidationError extends Error {
  /**
   * The rejected parameter/column name (or object name), when applicable. This
   * lets the route layer produce an `error-description` identifying exactly
   * what failed validation.
   */
  readonly parameter?: string;

  constructor(message: string, parameter?: string) {
    super(message);
    this.name = 'ValidationError';
    this.parameter = parameter;
    // Restore prototype chain for correct `instanceof` under transpiled ES targets.
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
