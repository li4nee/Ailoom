// SPDX-License-Identifier: AGPL-3.0-only
import { extname } from 'node:path';

/** What an upload may be (spec §12.1: PDF, TXT, MD, HTML, DOCX). */
export type DetectedFileType = 'pdf' | 'docx' | 'html' | 'markdown' | 'text';

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** A DOCX is a zip whose entry names include `word/document.xml`. */
const DOCX_MARKER = Buffer.from('word/document.xml', 'latin1');

/**
 * Extensions that promise a binary format. Valid UTF-8 under one of these is a disguised
 * file (an HTML page called `invoice.pdf`), not text: the extension lied, so reject it
 * rather than parse it as something it is not.
 */
const BINARY_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.zip',
  '.exe',
  '.dll',
  '.bin',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.gz',
  '.tar',
]);

const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/**
 * The type of an upload, by content first and extension second (spec §12.1). Binary formats
 * are recognised by their magic bytes, so a misleading file name cannot make us hand an
 * executable to a parser; text formats need the extension because their content is ambiguous.
 *
 * `bytes` should be the whole file, not a prefix: a zip keeps its entry names at the end.
 * Returns null for anything unsupported, which the caller answers with 415.
 */
export function detectFileType(bytes: Buffer, filename: string): DetectedFileType | null {
  if (bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'pdf';
  if (bytes.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    return bytes.includes(DOCX_MARKER) ? 'docx' : null;
  }

  const text = decodeText(bytes);
  if (text === null) return null;

  const extension = extname(filename).toLowerCase();
  if (HTML_EXTENSIONS.has(extension)) {
    return text.trimStart().startsWith('<') ? 'html' : null;
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (BINARY_EXTENSIONS.has(extension)) return null;
  return 'text';
}

/** The file as a string when it is UTF-8 text; null for a binary file (or invalid UTF-8). */
function decodeText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
