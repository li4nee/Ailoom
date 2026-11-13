// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectFileType } from './detect-file-type';

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'fixtures', 'files');

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe('detectFileType', () => {
  it.each([
    ['sample.pdf', 'pdf'],
    ['sample.docx', 'docx'],
    ['page.html', 'html'],
    ['notes.md', 'markdown'],
    ['notes.txt', 'text'],
    ['fake.pdf', null],
    ['program.exe.pdf', null],
    ['binary.txt', null],
    ['plain.zip.docx', null],
  ] as const)('%s → %s', (name, expected) => {
    expect(detectFileType(fixture(name), name)).toBe(expected);
  });

  it('rejects an html file whose content does not start with a tag', () => {
    expect(detectFileType(Buffer.from('just words\n<h1>late</h1>'), 'page.html')).toBeNull();
  });

  it('accepts a leading byte-order mark and whitespace before an html tag', () => {
    expect(detectFileType(Buffer.from('\uFEFF\n  <!doctype html><p>a</p>'), 'x.htm')).toBe('html');
  });

  it('treats an unknown text extension as text', () => {
    expect(detectFileType(Buffer.from('a;b\n'), 'data.csv')).toBe('text');
  });

  it('rejects a pdf header that is not at the start of the file', () => {
    expect(detectFileType(Buffer.from('x%PDF-1.4'), 'doc.pdf')).toBeNull();
  });
});
