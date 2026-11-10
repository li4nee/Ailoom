// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const API_ROOT = join(__dirname, '..');
// The package's exports hide its bin; pnpm links it package-locally, like `pnpm depcruise` uses.
const CLI = join(API_ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');

/** Runs `depcruise <path> --config .dependency-cruiser.cjs` the way `pnpm depcruise` does. */
function runDepcruise(path: string): { exitCode: number; output: string } {
  const result = spawnSync(process.execPath, [CLI, path, '--config', '.dependency-cruiser.cjs'], {
    cwd: API_ROOT,
    encoding: 'utf8',
  });
  return { exitCode: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

describe('dependency rules', () => {
  it('fails on cycles', () => {
    expect(runDepcruise('test/fixtures/depcruise-cycle')).toMatchObject({
      exitCode: 1,
      output: expect.stringContaining('no-circular') as unknown,
    });
  });

  it('passes on src', () => {
    const result = runDepcruise('src');
    expect(result.output).toContain('no dependency violations found');
    expect(result.exitCode).toBe(0);
  });
}, 60_000);
