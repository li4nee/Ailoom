// SPDX-License-Identifier: AGPL-3.0-only
import { type ErrorCode, errorEnvelopeSchema } from '@app/shared';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** Every failed API call: the server's error envelope, or a client-side stand-in for one. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];
  readonly requestId: string;

  constructor(init: {
    code: ErrorCode;
    status: number;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? '';
  }
}

/** Builds the ApiError for a non-2xx response; a body that is not an envelope still yields one. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const headerId = response.headers.get('X-Request-Id') ?? '';
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorEnvelopeSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details, requestId } = parsed.data.error;
    return new ApiError({
      code,
      status: response.status,
      message,
      details: details ?? [],
      requestId,
    });
  }
  return new ApiError({
    code: 'internal_error',
    status: response.status,
    message: `Request failed with status ${String(response.status)}`,
    requestId: headerId,
  });
}
