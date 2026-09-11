/**
 * SPA static serving integration tests (task 14.2).
 *
 * Verifies (Req 7.1, 7.2):
 *   - GET /admin serves the SPA (the placeholder shell is acceptable until the
 *     real web build exists).
 *   - An unknown deep path under /admin returns the SPA entry point so
 *     client-side routing can resolve it.
 *
 * The app is built with an empty env so no `EMULATOR_WEB_DIR` override applies
 * and (with no built `web/dist`) the placeholder shell is served.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, type TestApp } from './test-helpers.js';

let harness: TestApp | undefined;

afterEach(async () => {
  if (harness !== undefined) {
    await harness.close();
    harness = undefined;
  }
});

describe('SPA static serving at /admin (Req 7.1, 7.2)', () => {
  it('GET /admin serves the SPA entry point (Req 7.1)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/admin' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="root"');
  });

  it('unknown /admin/deep/link returns the SPA entry point (Req 7.2)', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({ method: 'GET', url: '/admin/deep/link' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="root"');
  });
});
