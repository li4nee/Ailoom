// SPDX-License-Identifier: AGPL-3.0-only
// Fixture for test/depcruise.spec.ts: a cycle made only of type imports, which compile away
// but still tie the two files together for anyone reading or refactoring them.
import type { B } from './b';

export interface A {
  b: B | null;
}
