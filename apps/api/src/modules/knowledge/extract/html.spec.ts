// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractHtml } from './html';
import { extractPlain } from './text';
import { ExtractError } from './types';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'html');
const PAGE = 'https://ex.com/docs/a';

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('extractHtml', () => {
  it('extracts the article body without nav and footer', () => {
    const result = extractHtml(fixture('article.html'), PAGE);

    expect(result.title).toBe('Refund policy');
    expect(result.markdown).toContain('## Eligibility');
    expect(result.markdown).not.toMatch(/Home \| Products|© 2026/);
  });

  it('keeps tables as GFM', () => {
    const markdown = extractHtml(fixture('table.html'), PAGE).markdown;

    expect(markdown).toMatch(/\| Plan \| Price \|/);
    expect(markdown).toMatch(/\| --- \| --- \|/);
  });

  it('absolutizes links and drops images and scripts', () => {
    const markdown = extractHtml(fixture('relative-links.html'), PAGE).markdown;

    expect(markdown).toContain('(https://ex.com/docs/b)');
    expect(markdown).not.toMatch(/!\[|<script|javascript:|screenshot\.png/);
    expect(markdown).toContain('(mailto:support@ex.com)');
  });

  it('flags SPA shells', () => {
    const result = extractHtml(fixture('spa-shell.html'), 'https://ex.com/app');

    expect(result.warnings).toContain('js_rendered_suspected');
  });

  it('flags login walls as low text', () => {
    const result = extractHtml(fixture('login-wall.html'), 'https://ex.com/login');

    expect(result.warnings).toContain('low_text_content');
  });

  it('drops navigation-heavy pages to their article', () => {
    const result = extractHtml(fixture('nav-heavy.html'), 'https://ex.com/products');

    expect(result.markdown).toContain('The catalogue changes every week');
    expect(result.markdown).not.toContain('Product 39');
  });

  it('truncates very large pages with a warning', () => {
    const result = extractHtml(`<article><p>${'word '.repeat(5000)}</p></article>`, PAGE, {
      maxMarkdownBytes: 200,
    });

    expect(result.warnings).toContain('truncated');
    expect(Buffer.byteLength(result.markdown, 'utf8')).toBeLessThanOrEqual(200);
  });

  it('never leaves raw HTML in the markdown', () => {
    expect(extractHtml('<p>a<iframe src=x></iframe><b onclick=x>b</b></p>', PAGE).markdown).toBe(
      'a**b**',
    );
  });
});

describe('extractPlain', () => {
  it('keeps markdown and flags short documents', () => {
    const result = extractPlain('# Notes\n\nA short note.\n', 'markdown', 'Notes');

    expect(result.markdown).toBe('# Notes\n\nA short note.');
    expect(result.warnings).toContain('low_text_content');
  });

  it('rejects an empty document', () => {
    expect(() => extractPlain('   \n', 'text', null)).toThrow(ExtractError);
  });
});
