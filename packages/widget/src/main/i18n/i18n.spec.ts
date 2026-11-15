// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCALE, loadLocale, pickLocale, t } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickLocale', () => {
  it('prefers an exact data-locale match', () => {
    expect(pickLocale('de', ['fr-FR'], ['en', 'de'])).toBe('de');
  });

  it('falls back to the base language of a browser locale', () => {
    expect(pickLocale(null, ['de-AT'], ['en', 'de'])).toBe('de');
  });

  it('falls back to English for an unknown language', () => {
    expect(pickLocale('ja', ['ja-JP'], ['en', 'de'])).toBe(DEFAULT_LOCALE);
  });
});

describe('loadLocale and t', () => {
  it('merges a fetched locale over English, so missing keys stay English', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ send: 'Senden' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    await loadLocale('de', 'https://chat.example.com');

    expect(fetch).toHaveBeenCalledWith('https://chat.example.com/widget/0.1.0/i18n/de.json');
    expect(t('send')).toBe('Senden');
    expect(t('privacy')).toBe('Privacy');
  });

  it('returns the key itself when no locale has it', () => {
    expect(t('doesNotExist')).toBe('doesNotExist');
  });
});
