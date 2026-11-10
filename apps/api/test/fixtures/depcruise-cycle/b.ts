// SPDX-License-Identifier: AGPL-3.0-only
// Fixture for test/depcruise.spec.ts: a two-file import cycle.
import { a } from './a';

export const b = 'b';

export function useB(): string {
  return a;
}
