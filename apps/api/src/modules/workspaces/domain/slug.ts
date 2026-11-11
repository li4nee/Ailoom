// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

const MAX_BASE_LENGTH = 40;
const FALLBACK = 'workspace';
const SUFFIX_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SUFFIX_LENGTH = 4;

/**
 * A readable URL slug: lowercase ASCII, words joined by `-`, at most 40 characters.
 * Diacritics are folded rather than dropped so "Ünïcödé" becomes "unicode", and an input
 * with nothing usable falls back to "workspace" (the caller adds a random suffix).
 */
export function slugify(name: string): string {
  const folded = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');
  return folded.length > 0 ? folded : FALLBACK;
}

/** Four random base36 characters, so two workspaces with the same name stay distinct. */
export function slugSuffix(): string {
  let suffix = '';
  for (const byte of randomBytes(SUFFIX_LENGTH)) {
    suffix += SUFFIX_ALPHABET.charAt(byte % SUFFIX_ALPHABET.length);
  }
  return suffix;
}

export function workspaceSlug(name: string): string {
  return `${slugify(name)}-${slugSuffix()}`;
}
