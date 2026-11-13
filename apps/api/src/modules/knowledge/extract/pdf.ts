// SPDX-License-Identifier: AGPL-3.0-only
import { extractText, getDocumentProxy } from 'unpdf';

import { qualityWarnings } from './quality';
import { ExtractError, type ExtractResult } from './types';

/** A line holding only a form feed separates two pages; the chunker starts a chunk there. */
export const PAGE_BREAK = '\f';

/** Spec §12.1: a PDF source is capped at 500 pages. */
export const PDF_MAX_PAGES = 500;

/** Fewer characters than this per page means the file is images, not text. */
const MIN_CHARS_PER_PAGE = 20;

/**
 * Extracts a PDF's text (spec §12.3). A scan has no text layer to index and an encrypted
 * file cannot be read at all, so both fail the source instead of storing empty chunks.
 */
export async function extractPdf(
  data: Uint8Array,
  opts: { maxPages?: number } = {},
): Promise<ExtractResult> {
  const bytes = Buffer.from(data);
  if (isEncrypted(bytes)) {
    throw new ExtractError('pdf_encrypted', 'The PDF is password-protected.');
  }

  const maxPages = opts.maxPages ?? PDF_MAX_PAGES;
  const pdf = await open(bytes);
  const truncated = pdf.numPages > maxPages;

  let pages: string[];
  try {
    const extracted = await extractText(pdf, { mergePages: false });
    pages = extracted.text.slice(0, maxPages);
  } catch (error) {
    throw new ExtractError('unsupported_content', describe(error));
  }

  const markdown = pages
    .map((page) => page.replace(/\r\n?/g, '\n').trim())
    .join(`\n${PAGE_BREAK}\n`)
    .trim();

  const characters = markdown.replace(/\s/g, '').length;
  if (pages.length > 0 && characters / pages.length < MIN_CHARS_PER_PAGE) {
    throw new ExtractError(
      'pdf_no_text_layer',
      'The PDF has no text layer; it is probably a scan.',
    );
  }

  const warnings = qualityWarnings({ htmlBytes: 0, markdown, hasEmptyAppRoot: false });
  if (truncated) warnings.push('truncated');

  return { title: titleOf(markdown, await metadataTitle(pdf)), markdown, warnings };
}

async function open(bytes: Buffer): Promise<Awaited<ReturnType<typeof getDocumentProxy>>> {
  try {
    return await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    const name = (error as { name?: unknown }).name;
    if (name === 'PasswordException') {
      throw new ExtractError('pdf_encrypted', 'The PDF is password-protected.');
    }
    throw new ExtractError('unsupported_content', describe(error));
  }
}

/**
 * pdf.js would ask for a password; we do not have one, and the raw trailer tells us earlier.
 * Raw bytes: the `/Encrypt` entry is part of the file format, not content we can parse.
 */
function isEncrypted(bytes: Buffer): boolean {
  return bytes.includes('%PDF-') && /\/Encrypt[\s/<[]/.test(bytes.toString('latin1'));
}

async function metadataTitle(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
): Promise<string | null> {
  try {
    const metadata = await pdf.getMetadata();
    const title = (metadata.info as { Title?: unknown }).Title;
    return typeof title === 'string' ? title : null;
  } catch {
    return null;
  }
}

/** A PDF written by an office suite often has no title metadata; its first line will do. */
function titleOf(markdown: string, metadata: string | null): string | null {
  const fromMetadata = metadata?.trim();
  if (fromMetadata !== undefined && fromMetadata !== '') return fromMetadata;

  const firstLine = markdown.split('\n').find((line) => line.trim() !== '');
  if (firstLine === undefined) return null;
  const title = firstLine.replace(/^#+\s*/, '').trim();
  return title === '' || title.length > 200 ? null : title;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
