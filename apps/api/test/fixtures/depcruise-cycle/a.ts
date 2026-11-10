// SPDX-License-Identifier: AGPL-3.0-only
// Fixture for test/depcruise.spec.ts: a two-file import cycle.
import { b } from './b';

export const a = 'a';

export function useA(): string {
  return b;
}
