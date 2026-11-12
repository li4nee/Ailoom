// SPDX-License-Identifier: AGPL-3.0-only
import type { ExtractionWarning } from './types';

/** Below this much text a page is probably a login wall or a stub, not documentation. */
const MIN_WORDS = 50;
/** A page this big that still has little text was almost certainly rendered by JavaScript. */
const SUSPICIOUS_HTML_BYTES = 20_000;
/** Readability needs a few words to work with; below this the page may be a shell. */
const SUSPICIOUS_TEXT_LENGTH = 200;

function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter((word) => word !== '').length;
}

/**
 * The quality warnings of an extraction (spec §12.3): a shell that renders client-side, or a
 * page with next to no text (a login wall, a soft 404). The page is still recorded — a
 * warning is information for the admin, not a failure.
 */
export function qualityWarnings(input: {
  htmlBytes: number;
  markdown: string;
  hasEmptyAppRoot: boolean;
}): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  const text = input.markdown.trim();

  if (
    input.hasEmptyAppRoot ||
    (text.length < SUSPICIOUS_TEXT_LENGTH && input.htmlBytes > SUSPICIOUS_HTML_BYTES)
  ) {
    warnings.push('js_rendered_suspected');
  }
  if (countWords(text) < MIN_WORDS) warnings.push('low_text_content');

  return warnings;
}
