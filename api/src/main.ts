/**
 * Control-iD Facial Emulator — API entrypoint (task 14.1).
 *
 * Startup sequence (Req 9.4, 10.1, 10.4):
 *   1. `bootstrap(process.env)` resolves + validates configuration, applies the
 *      state mode, opens the store, and seeds defaults — all BEFORE any port is
 *      bound. A {@link BootstrapError} (or any startup failure) is logged with
 *      its specific message and the process exits non-zero WITHOUT listening
 *      (Req 10.4).
 *   2. `buildContainer(db, resolved)` wires the service graph.
 *   3. `buildApp(container, resolved)` assembles the Fastify app.
 *   4. `app.listen({ port, host: '0.0.0.0' })` binds the single exposed port
 *      only after the mode has been applied (Req 9.4, 10.1).
 *
 * SIGINT/SIGTERM close the server gracefully.
 *
 * This module is the composition entrypoint only; it is not imported by tests
 * (which build the app directly via `buildContainer`/`buildApp`).
 */
import { bootstrap } from './composition/bootstrap.js';
import { buildContainer } from './composition/container.js';
import { buildApp } from './composition/app.js';

async function main(): Promise<void> {
  // Bootstrap applies the state mode and opens the store before we bind a port.
  // Any failure here must abort startup without listening (Req 10.4).
  const { resolved, db } = await bootstrap(process.env);

  const container = buildContainer(db, resolved);
  const app = await buildApp(container, resolved, { logger: true });

  await app.listen({ port: resolved.port, host: '0.0.0.0' });
  console.log(
    `[controlid-facial-emulator] listening on 0.0.0.0:${String(resolved.port)} ` +
      `(mode=${resolved.mode}); control panel at /admin`,
  );

  // Graceful shutdown on termination signals.
  const shutdown = (signal: string): void => {
    console.log(`[controlid-facial-emulator] received ${signal}, shutting down…`);
    app
      .close()
      .then(() => {
        db.$client.close();
        process.exit(0);
      })
      .catch((err: unknown) => {
        console.error('[controlid-facial-emulator] error during shutdown:', err);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

main().catch((err: unknown) => {
  // Startup failure (bootstrap/build/listen): log the specific message and exit
  // non-zero without listening (Req 10.4).
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[controlid-facial-emulator] startup failed: ${message}`);
  process.exit(1);
});
