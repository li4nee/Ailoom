// SPDX-License-Identifier: AGPL-3.0-only

/** Why an extraction is imperfect but still usable; stored on the source and shown in the admin. */
export type ExtractionWarning = 'js_rendered_suspected' | 'low_text_content' | 'truncated';

export type ExtractErrorCode =
  'pdf_no_text_layer' | 'pdf_encrypted' | 'unsupported_content' | 'empty_content';

/** A file we cannot read at all: the source fails instead of indexing garbage. */
export class ExtractError extends Error {
  override readonly name = 'ExtractError';

  constructor(
    readonly code: ExtractErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface ExtractResult {
  /** The document's own title; null when the page has none. */
  title: string | null;
  markdown: string;
  warnings: ExtractionWarning[];
}
