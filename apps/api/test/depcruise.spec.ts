// SPDX-License-Identifier: AGPL-3.0-only
import { cruise } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';

interface DepcruiserResult {
  exitCode: number;
  output: string;
}

type DepcruiseFn = (
  files: string[],
  options?: { configFile?: string },
) => Promise<DepcruiserResult>;

const depcruise: DepcruiseFn = cruise as unknown as DepcruiseFn;

describe('dependency-cruiser', () => {
  it('passes on src', async () => {
    const result = await depcruise(['src'], { configFile: '.dependency-cruiser.cjs' });
    expect(result.exitCode).toBe(0);
  });

  it('runs on cycle fixtures without crashing', async () => {
    const result = await depcruise(['test/fixtures/depcruise-cycle'], {
      configFile: '.dependency-cruiser.cjs',
    });
    expect(result.exitCode).toBe(0);
  });
});
