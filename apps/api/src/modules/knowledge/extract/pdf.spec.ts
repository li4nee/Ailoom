// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractPdf, PAGE_BREAK } from './pdf';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'files');

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe('extractPdf', () => {
  it('extracts every page separated by a page break', async () => {
    const result = await extractPdf(fixture('sample.pdf'));

    expect(result.markdown).toContain('Our refund policy applies to every subscription.');
    expect(result.markdown).toContain('A full refund is available within 30 days');
    expect(result.markdown).toContain(`\n${PAGE_BREAK}\n`);
    expect(result.markdown.indexOf('Our refund policy')).toBeLessThan(
      result.markdown.indexOf('A full refund'),
    );
  });

  it('takes the title from the first line when the PDF has no metadata title', async () => {
    const result = await extractPdf(fixture('sample.pdf'));

    expect(result.title).toBe('Refund policy');
  });

  it('rejects a page with no text layer', async () => {
    await expect(extractPdf(fixture('scanned.pdf'))).rejects.toMatchObject({
      code: 'pdf_no_text_layer',
    });
  });

  it('rejects an encrypted PDF instead of returning nonsense', async () => {
    await expect(extractPdf(fixture('encrypted.pdf'))).rejects.toMatchObject({
      code: 'pdf_encrypted',
    });
  });

  it('stops at maxPages and warns', async () => {
    const result = await extractPdf(fixture('three-pages.pdf'), { maxPages: 2 });

    expect(result.markdown).toContain('Page two');
    expect(result.markdown).not.toContain('Page three');
    expect(result.warnings).toContain('truncated');
  });
});
