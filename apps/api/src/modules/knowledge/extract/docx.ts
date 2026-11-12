// SPDX-License-Identifier: AGPL-3.0-only
import mammoth from 'mammoth';

import { htmlToMarkdown } from './html';
import { qualityWarnings } from './quality';
import { ExtractError, type ExtractResult } from './types';

/**
 * Extracts a Word document (spec §12.3). Mammoth turns the OOXML into HTML with headings and
 * tables intact; the same Turndown setup as pages converts it, minus Readability, because a
 * document *is* the article already.
 */
export async function extractDocx(data: Buffer): Promise<ExtractResult> {
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: data })).value;
  } catch (error) {
    throw new ExtractError(
      'unsupported_content',
      error instanceof Error ? error.message : String(error),
    );
  }

  const markdown = htmlToMarkdown(withTableHeaders(html));
  if (markdown.trim() === '') {
    throw new ExtractError('empty_content', 'The document has no text.');
  }

  return {
    title: titleOf(markdown),
    markdown,
    warnings: qualityWarnings({ htmlBytes: 0, markdown, hasEmptyAppRoot: false }),
  };
}

/**
 * Mammoth emits `<td>` rows without a header row, and Turndown's GFM plugin needs one to
 * produce a table. Marking the first row as a header keeps the table a table.
 */
function withTableHeaders(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/gi, (table, body: string) => {
    // A cell holds block elements (`<p>`); Turndown would turn each into a newline and break
    // the row into separate lines. Flatten them to one line per cell.
    const flat = body.replace(/<\/?p[^>]*>/gi, ' ').replace(/\s+/gi, ' ');
    if (/<th[\s>]/i.test(flat)) return `<table>${flat}</table>`;
    const withHeaders = flat.replace(/<tr>([\s\S]*?)<\/tr>/i, (row) =>
      row.replace(/<td([\s>])/gi, '<th$1').replace(/<\/td>/gi, '</th>'),
    );
    return `<table>${withHeaders}</table>`;
  });
}

/** The first heading is the document's title; Word documents rarely have metadata semantics. */
function titleOf(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (heading !== null) return heading[1] ?? null;
  }
  const firstLine = markdown.split('\n').find((line) => line.trim() !== '');
  return firstLine === undefined ? null : firstLine.replace(/^#+\s*/, '').trim() || null;
}
