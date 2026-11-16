// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONFIG_ENV_KEYS } from '../common/config/config.schema';
import { CONFIG_BEGIN, CONFIG_END, renderConfigurationReference } from './docs-config';

const docs = resolve(__dirname, '../../../../apps/docs/src/content/docs/configuration.md');

describe('configuration docs', () => {
  it('documents every environment key', () => {
    const page = readFileSync(docs, 'utf8');
    const begin = page.indexOf(CONFIG_BEGIN);
    const end = page.indexOf(CONFIG_END);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);

    const reference = page.slice(begin, end);
    for (const key of CONFIG_ENV_KEYS) {
      expect(reference).toContain(`\`${key}\``);
    }
  });

  it('matches the generator output', () => {
    const page = readFileSync(docs, 'utf8');
    const begin = page.indexOf(CONFIG_BEGIN) + CONFIG_BEGIN.length;
    const end = page.indexOf(CONFIG_END);
    expect(page.slice(begin, end).trim()).toBe(renderConfigurationReference());
  });
});
