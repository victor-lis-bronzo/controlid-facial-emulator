/**
 * Property-based test for SessionService (Correctness Property 3: Session validity).
 *
 * Uses an injected controllable clock so elapsed time can be sampled around the
 * 3600-second TTL boundary without real waiting. Each iteration gets a fresh
 * ephemeral (`:memory:`) database and a fresh SessionService.
 *
 * See design.md → "Correctness Properties → Property 3" and Requirement 2.4, 2.5.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createDb } from '../db/connection.js';
import { SessionService, SESSION_TTL_SECONDS } from './session-service.js';

const TTL_MS = SESSION_TTL_SECONDS * 1000;

// Feature: controlid-facial-emulator, Property 3: for any token issued by a successful login, a request presenting that token validates as 'valid' while elapsed since issuance < 3600s and is rejected (not 'valid', i.e. 'expired') at/after 3600s; any absent, empty, malformed, or unknown token validates as 'invalid'.
describe('SessionService — Property 3: Session validity', () => {
  it('issued tokens are valid iff elapsed < TTL; bogus tokens are always invalid', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Issuance instant (epoch ms), kept well away from overflow.
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        // Elapsed offset spanning below and at/above the 3_600_000 ms boundary.
        fc.integer({ min: -60_000, max: TTL_MS + 60_000 }),
        // A bogus token: absent, empty, malformed, or a plausible-but-unknown value.
        fc.oneof(
          fc.constant(undefined),
          fc.constant(''),
          // Malformed: contains characters outside the base64url alphabet.
          fc
            .string({ minLength: 1, maxLength: 40 })
            .filter((s) => /[^A-Za-z0-9_-]/.test(s)),
          // Well-formed alphabet but never issued (unknown) — prefix keeps it
          // distinct from any real issued token.
          fc
            .string({ minLength: 1, maxLength: 40 })
            .map((s) => `bogus-${s.replace(/[^A-Za-z0-9_-]/g, '')}`),
        ),
        async (issuedAt, elapsed, bogusToken) => {
          // Controllable clock: tests advance time by mutating `current`.
          let current = issuedAt;
          const clock = (): number => current;

          const db = createDb({ mode: 'ephemeral' });
          try {
            const service = new SessionService(db, clock);

            // Issue a token at the issuance instant.
            const issued = await service.issue();
            expect(issued.token).not.toBe('');
            expect(issued.issuedAt).toBe(issuedAt);
            expect(issued.expiresAt).toBe(issuedAt + TTL_MS);

            // Advance the clock to `issuedAt + elapsed` and validate the token.
            current = issuedAt + elapsed;
            const verdict = await service.validate(issued.token);

            if (elapsed < TTL_MS) {
              // Within TTL → processed.
              expect(verdict).toBe('valid');
            } else {
              // At/after TTL → rejected (not 'valid'), specifically 'expired'.
              expect(verdict).not.toBe('valid');
              expect(verdict).toBe('expired');
            }

            // Any absent/empty/malformed/unknown token is 'invalid' regardless
            // of elapsed time (and is guaranteed distinct from the issued one).
            fc.pre(bogusToken !== issued.token);
            const bogusVerdict = await service.validate(bogusToken);
            expect(bogusVerdict).toBe('invalid');
          } finally {
            db.$client.close();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
