// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt } from 'node:crypto';

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
    .replace(/[^a-z0-9]+/g, '-');
  const trimmed = trimDashes(trimDashes(folded).slice(0, MAX_BASE_LENGTH));
  return trimmed.length > 0 ? trimmed : FALLBACK;
}

/** Strips leading and trailing `-` without a backtracking regex. */
function trimDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
}

/** Four random base36 characters, so two workspaces with the same name stay distinct. */
export function slugSuffix(): string {
  let suffix = '';
  // randomInt is uniform; `byte % 36` over-weighted the first four characters.
  for (let index = 0; index < SUFFIX_LENGTH; index += 1) {
    suffix += SUFFIX_ALPHABET.charAt(randomInt(SUFFIX_ALPHABET.length));
  }
  return suffix;
}

export function workspaceSlug(name: string): string {
  return `${slugify(name)}-${slugSuffix()}`;
}
