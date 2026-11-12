// SPDX-License-Identifier: AGPL-3.0-only
import { qualityWarnings } from './quality';
import { ExtractError, type ExtractResult } from './types';

/**
 * A Markdown or plain-text document is already the content; only the quality warnings apply.
 * Markdown keeps its markup, because headings and lists are what the chunker groups by.
 */
export function extractPlain(
  text: string,
  kind: 'markdown' | 'text',
  title: string | null,
): ExtractResult {
  const markdown = text.replace(/\r\n?/g, '\n').trim();
  if (markdown === '') throw new ExtractError('empty_content', 'The document has no text.');

  return {
    title,
    markdown,
    // `kind` decides how the chunks are grouped later, not how the text is read.
    warnings: qualityWarnings({
      htmlBytes: Buffer.byteLength(text, 'utf8'),
      markdown,
      hasEmptyAppRoot: false,
    }),
  };
}
