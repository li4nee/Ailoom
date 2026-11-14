// SPDX-License-Identifier: MIT
import { WIDGET_VERSION } from '../../version';
import en from './en.json';

export const DEFAULT_LOCALE = 'en';

type Messages = Record<string, string>;

const english = en as Messages;
let current: Messages = english;

/** Locales this build ships; Task 5.13 ships English, community files add more. */
export const AVAILABLE_LOCALES = ['en'] as const;

export function availableLocales(): string[] {
  return [...AVAILABLE_LOCALES];
}

/**
 * Exact match, then base language, then English (spec §16.3). `data-locale` wins over the
 * browser's preferences; `en-US` matches `en`.
 */
export function pickLocale(
  dataLocale: string | null,
  navigatorLanguages: readonly string[],
  available: string[],
): string {
  const wanted = [dataLocale, ...navigatorLanguages]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map((value) => value.trim().toLowerCase());

  for (const tag of wanted) {
    const exact = available.find((locale) => locale.toLowerCase() === tag);
    if (exact !== undefined) return exact;
    const base = tag.split('-')[0];
    if (base !== undefined) {
      const parent = available.find((locale) => locale.toLowerCase() === base);
      if (parent !== undefined) return parent;
    }
  }
  return available.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : (available[0] ?? DEFAULT_LOCALE);
}

/**
 * Loads one locale file lazily from the platform's versioned bundle directory. English is
 * bundled; any other locale is one small JSON fetch, and a failure leaves English in place.
 */
export async function loadLocale(locale: string, origin: string): Promise<void> {
  if (locale === DEFAULT_LOCALE) {
    current = english;
    return;
  }
  try {
    const response = await fetch(
      `${origin}/widget/${WIDGET_VERSION}/i18n/${encodeURIComponent(locale)}.json`,
    );
    if (!response.ok) return;
    current = { ...english, ...((await response.json()) as Messages) };
  } catch {
    // A missing or blocked locale file is not an error: English still works.
  }
}

/** `t('handoff.offered', { name: 'Ada' })`; a missing key falls back to English, then the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = current[key] ?? english[key] ?? key;
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}
