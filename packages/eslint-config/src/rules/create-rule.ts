// SPDX-License-Identifier: MIT
import { ESLintUtils } from '@typescript-eslint/utils';

export interface LocalRuleDocs {
  requiresTypeChecking?: boolean;
}

export const createRule = ESLintUtils.RuleCreator<LocalRuleDocs>(
  (name) =>
    `https://github.com/li4nee/ailoom/blob/main/packages/eslint-config/src/rules/${name}.ts`,
);
