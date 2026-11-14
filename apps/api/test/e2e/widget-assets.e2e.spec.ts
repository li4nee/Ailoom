// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';

const VERSION = '9.9.9';
const LOADER = '/* ailoom widget loader 9.9.9 */ (() => {})();';

describe('widget assets', () => {
  let t: TestApp;
  let directory: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'widget-dist-'));
    writeFileSync(join(directory, 'widget.js'), LOADER);
    mkdirSync(join(directory, VERSION, 'i18n'), { recursive: true });
    writeFileSync(join(directory, VERSION, 'main.js'), 'export const version = "9.9.9";');
    writeFileSync(join(directory, VERSION, 'challenge-worker.js'), 'self.onmessage = () => {};');
    writeFileSync(join(directory, VERSION, 'i18n', 'en.json'), '{"send":"Send"}');

    t = await createTestApp({ widgetDistDir: directory });
  });

  afterAll(async () => {
    await t.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('serves the loader at the origin root with a short cache', async () => {
    const r = await t.http.get('/widget.js');

    expect(r.status).toBe(200);
    expect(r.text).toBe(LOADER);
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.headers['cache-control']).toBe('public, max-age=300');
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves versioned files as immutable, including nested i18n files', async () => {
    const main = await t.http.get(`/widget/${VERSION}/main.js`);

    expect(main.status).toBe(200);
    expect(main.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(main.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(main.headers['access-control-allow-origin']).toBe('*');
    expect(main.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const locale = await t.http.get(`/widget/${VERSION}/i18n/en.json`);

    expect(locale.status).toBe(200);
    expect(locale.body).toEqual({ send: 'Send' });
    expect(locale.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('serves the challenge worker', async () => {
    const r = await t.http.get(`/widget/${VERSION}/challenge-worker.js`);

    expect(r.status).toBe(200);
    expect(r.text).toBe('self.onmessage = () => {};');
  });

  it('answers 404 for an unknown version or file', async () => {
    await expect(t.http.get('/widget/0.0.0/main.js')).resolves.toMatchObject({ status: 404 });
    await expect(t.http.get(`/widget/${VERSION}/missing.js`)).resolves.toMatchObject({
      status: 404,
    });
  });

  it('cannot escape the allowlist with encoded traversal', async () => {
    const r = await t.http.get(`/widget/${VERSION}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

    expect(r.status).toBe(404);
    expect(r.text).not.toContain('root:');
  });
});
