// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ends an exhaustive switch over a union: the compiler narrows `value` to `never`, so a new
 * member without a case is a compile error and the switch stays total.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
