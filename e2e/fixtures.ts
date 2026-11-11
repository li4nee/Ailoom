// SPDX-License-Identifier: AGPL-3.0-only
import { test as base } from '@playwright/test';

import { extractLink, mailpit } from './mailpit';
import { BASE_URL } from './stack';

/**
 * `stack` is the running app (started once by global-setup); `mailpit` reads its mail. Tests
 * import `test` and `expect` from here.
 */
export const test = base.extend<{ mailpit: typeof mailpit }, { stack: { baseURL: string } }>({
  stack: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
    async ({}, use) => {
      await use({ baseURL: BASE_URL });
    },
    { scope: 'worker' },
  ],
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  mailpit: async ({}, use) => {
    await use(mailpit);
  },
});

export { expect } from '@playwright/test';
export { extractLink };
