// SPDX-License-Identifier: AGPL-3.0-only
import { b } from './b';

export const a = 'a';
export function useA(): unknown {
  return b();
}
