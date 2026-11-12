// SPDX-License-Identifier: AGPL-3.0-only
import type { ErrorCode } from '@app/shared';

import type { ExtractErrorCode } from './extract';

/** Every failure a source can end with, plus the provider codes worth naming separately. */
export type IngestFailureCode =
  | ExtractErrorCode
  | 'auth_failed'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'model_not_found'
  | 'timeout'
  | 'blocked_url'
  | 'connection_failed'
  | 'http_error'
  | 'bad_content_type'
  | 'too_large'
  | 'empty_content';

const MESSAGES: Record<IngestFailureCode, string> = {
  pdf_no_text_layer:
    "This PDF has no text layer (it's probably scanned). OCR is not supported yet.",
  pdf_encrypted: 'This PDF is password-protected. Remove the password and upload it again.',
  unsupported_content: 'This file could not be read. Export it again and upload a fresh copy.',
  empty_content: 'This document has no text to index.',
  auth_failed: 'The embedding provider rejected the API key. Update the credential and resync.',
  rate_limited: 'The embedding provider is rate limiting requests. Resync in a few minutes.',
  quota_exceeded: 'The embedding provider quota is exhausted. Check the provider account.',
  model_not_found: 'The embedding provider does not offer this model.',
  timeout: 'The provider did not respond in time. Resync to try again.',
  blocked_url: 'This address cannot be fetched. Use a public http(s) URL.',
  connection_failed: 'The site could not be reached. Check the URL and resync.',
  http_error: 'The site answered with an error for this page.',
  bad_content_type: 'This page is not HTML, text or a PDF, so there is nothing to index.',
  too_large: 'This file or page is larger than the ingestion limit.',
};

/** The copy an admin sees on a failed source; never a stack trace or provider body. */
export function errorMessageFor(code: IngestFailureCode | ErrorCode): string {
  return code in MESSAGES ? MESSAGES[code as IngestFailureCode] : 'Ingestion failed.';
}

/** A page-level failure whose code maps to user-facing copy. */
export class IngestFailure extends Error {
  override readonly name = 'IngestFailure';

  constructor(readonly code: IngestFailureCode) {
    super(errorMessageFor(code));
  }
}
