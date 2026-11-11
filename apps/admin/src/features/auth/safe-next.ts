// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The post-login destination from `?next=`. Only same-site absolute paths are allowed, so a
 * crafted link cannot bounce the user to another site after they sign in.
 */
export function safeNext(next: string | undefined): string {
  if (!next?.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
