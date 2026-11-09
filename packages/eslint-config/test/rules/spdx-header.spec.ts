// SPDX-License-Identifier: MIT
import { RuleTester } from '@typescript-eslint/rule-tester';

import { spdxHeader } from '../../src/rules/spdx-header.js';

// The tag is split so REUSE does not read these test strings as this file's license.
const TAG = 'SPDX-License-' + 'Identifier';

const ruleTester = new RuleTester();

ruleTester.run('spdx-header', spdxHeader, {
  valid: [
    { code: `// ${TAG}: MIT\nexport {};`, options: [{ license: 'MIT' }] },
    { code: `#!/usr/bin/env node\n// ${TAG}: MIT\nexport {};`, options: [{ license: 'MIT' }] },
  ],
  invalid: [
    {
      code: 'export {};',
      options: [{ license: 'MIT' }],
      errors: [{ messageId: 'missingHeader' }],
      output: `// ${TAG}: MIT\nexport {};`,
    },
    {
      code: `// ${TAG}: AGPL-3.0-only\nexport {};`,
      options: [{ license: 'MIT' }],
      errors: [{ messageId: 'wrongLicense' }],
    },
    {
      code: `// some other comment\nexport {};`,
      options: [{ license: 'AGPL-3.0-only' }],
      errors: [{ messageId: 'missingHeader' }],
      output: `// ${TAG}: AGPL-3.0-only\n// some other comment\nexport {};`,
    },
    {
      code: `export {}; // ${TAG}: MIT`,
      options: [{ license: 'MIT' }],
      errors: [{ messageId: 'missingHeader' }],
      output: `// ${TAG}: MIT\nexport {}; // ${TAG}: MIT`,
    },
    {
      code: '#!/usr/bin/env node\nexport {};',
      options: [{ license: 'MIT' }],
      errors: [{ messageId: 'missingHeader' }],
      output: `#!/usr/bin/env node\n// ${TAG}: MIT\nexport {};`,
    },
  ],
});
