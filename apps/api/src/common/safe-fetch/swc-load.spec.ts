// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const apiRoot = resolve(__dirname, '../../..');

/**
 * Vitest compiles to ES modules, so it cannot catch CommonJS interop bugs (a default import
 * of a CJS package becomes `undefined.default`). This loads the code the way the TypeORM CLI
 * and other `@swc-node/register` entrypoints do.
 */
function runUnderSwc(script: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['-r', '@swc-node/register', '-e', script], {
    cwd: apiRoot,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('safe-fetch under @swc-node/register (CommonJS)', () => {
  it('loads and classifies an address', () => {
    const r = runUnderSwc(
      "const { classifyIp, parseTarget } = require('./src/common/safe-fetch');" +
        "process.stdout.write(classifyIp('127.0.0.1') + ' ' + parseTarget('http://[::1]/').host);",
    );
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('loopback ::1');
    expect(r.status).toBe(0);
  }, 60_000);
});
