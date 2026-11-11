// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from 'zod';

import { errorForStatus, ProviderError } from '../errors';

/** A base URL without its trailing slashes: providers expect `<base>/<path>`. */
export function trimBaseUrl(url: string | null, fallback: string): string {
  return (url ?? fallback).replace(/\/+$/, '');
}

/**
 * GETs a provider's JSON document and validates its shape. Both failures stay normalized:
 * a non-2xx status becomes its `ProviderErrorCode`, and an unexpected body becomes
 * `provider_error`, so no raw provider output ever escapes this file.
 */
export async function getJson<S extends z.ZodType>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  schema: S,
): Promise<z.output<S>> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw errorForStatus(response.status);
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ProviderError('provider_error');
  return parsed.data;
}
