// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api-error';

/** A 4xx will not change on retry; only network and server errors are retried, twice. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
