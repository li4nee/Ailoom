// SPDX-License-Identifier: AGPL-3.0-only
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-case': [2, 'always', 'kebab-case'],
  },
};
