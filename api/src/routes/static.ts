/**
 * StaticAssetServer (task 14.1) — serves the built React SPA at `/admin` with an
 * `index.html` fallback so client-side routing resolves unknown sub-paths
 * (Req 7.1, 7.2).
 *
 * The SPA lives in a build directory resolved from, in order:
 *   1. `EMULATOR_WEB_DIR` (explicit override), else
 *   2. `web/dist` resolved relative to the compiled app (../../web/dist from
 *      `dist/routes`), else the repo `web/dist` in dev.
 *
 * Because the `web/` app is not built yet, this guards gracefully: when the
 * resolved directory has no `index.html`, it serves a minimal placeholder SPA
 * shell (a small inline HTML string) at `/admin` and for any `/admin/*` path.
 * This keeps the server booting and the SPA-serving/fallback tests meaningful
 * before the real build exists; the real assets take over automatically once
 * `web/dist/index.html` is present (documented for the later web build task).
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Minimal placeholder SPA shell served until the real `web/dist` is built. */
const PLACEHOLDER_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Control-iD Facial Emulator — Control Panel</title>
  </head>
  <body>
    <div id="root" data-placeholder="true">
      <h1>Control-iD Facial Emulator</h1>
      <p>The control panel web build is not present yet. This is a placeholder
         shell served by the API. Build the <code>web/</code> app to replace it.</p>
    </div>
  </body>
</html>
`;

/** Resolve the directory that should hold the built SPA assets. */
function resolveWebDir(env: Record<string, string | undefined>): string {
  const override = env.EMULATOR_WEB_DIR;
  if (override !== undefined && override.trim() !== '') {
    return resolve(override.trim());
  }
  // Compiled location: dist/routes/static.js → repo web/dist is ../../../web/dist.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'web', 'dist');
}

/**
 * Register SPA serving at `/admin`. When a real build exists, `@fastify/static`
 * serves it with an `index.html` fallback for unknown sub-paths (Req 7.2).
 * Otherwise a placeholder shell is served for `/admin` and every `/admin/*`.
 */
export async function registerStaticAssets(
  app: FastifyInstance,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const webDir = resolveWebDir(env);
  const indexPath = join(webDir, 'index.html');
  const hasBuild = existsSync(indexPath);

  if (hasBuild) {
    // Serve the real built SPA under /admin with SPA-history fallback.
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: '/admin/',
      wildcard: false,
    });

    const serveIndex = (_request: FastifyRequest, reply: FastifyReply): void => {
      reply.type('text/html').sendFile('index.html', webDir);
    };
    // `/admin` (no trailing slash) and unknown `/admin/*` sub-paths → index.html.
    app.get('/admin', serveIndex);
    app.get('/admin/*', serveIndex);
    return;
  }

  // No build present: serve the placeholder shell for /admin and all sub-paths.
  const servePlaceholder = (_request: FastifyRequest, reply: FastifyReply): void => {
    reply.type('text/html').send(PLACEHOLDER_INDEX_HTML);
  };
  app.get('/admin', servePlaceholder);
  app.get('/admin/*', servePlaceholder);
}
