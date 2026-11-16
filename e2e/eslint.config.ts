// SPDX-License-Identifier: AGPL-3.0-only
import { createConfig } from '@app/eslint-config';

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  license: 'AGPL-3.0-only',
  // The harness's switches (CI, reuse a running stack, skip the image build).
  processEnvAllow: [
    'playwright.config.ts',
    'global-setup.ts',
    'global-teardown.ts',
    'scripts/record-demo.ts',
  ],
});
