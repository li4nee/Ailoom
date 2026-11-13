// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractDocx } from './docx';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'files');

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe('extractDocx', () => {
  it('turns headings and tables into markdown', async () => {
    const result = await extractDocx(fixture('sample.docx'));

    expect(result.markdown).toContain('# Shipping policy');
    expect(result.markdown).toContain('## Rates');
    expect(result.markdown).toContain('Orders ship within two business days.');
    expect(result.markdown).toMatch(/\| Plan \| Price \|/);
    expect(result.markdown).toMatch(/\| Standard \| Free \|/);
  });

  it('takes the title from the first heading', async () => {
    const result = await extractDocx(fixture('sample.docx'));

    expect(result.title).toBe('Shipping policy');
  });

  it('rejects a zip that is not a Word document', async () => {
    await expect(extractDocx(fixture('plain.zip.docx'))).rejects.toMatchObject({
      code: 'unsupported_content',
    });
  });
});
