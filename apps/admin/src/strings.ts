// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every user-facing string in the admin. Components never inline copy, so wording changes in
 * one place and a later translation has a single source.
 */
export const strings = {
  app: {
    name: 'AiLoom',
    loading: 'Loading…',
    notFound: 'Page not found.',
    backHome: 'Back to home',
    genericError: 'Something went wrong. Please try again.',
    requestId: (id: string) => `Reference: ${id}`,
  },
} as const;
