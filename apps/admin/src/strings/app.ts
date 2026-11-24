// SPDX-License-Identifier: AGPL-3.0-only
export const app = {
  name: 'AiLoom',
  loading: 'Loading…',
  notFound: 'Page not found.',
  backHome: 'Back to home',
  genericError: 'Something went wrong. Please try again.',
  requestId: (id: string) => `Reference: ${id}`,
  nextPage: 'Next page',
  previousPage: 'Previous page',
} as const;
