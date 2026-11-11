// SPDX-License-Identifier: MIT
import { fixupPluginRules } from '@eslint/compat';
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import type { ESLint, Linter } from 'eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { plugin } from './plugin.js';

export { plugin } from './plugin.js';

export type License = 'AGPL-3.0-only' | 'MIT' | 'CC-BY-4.0';

export interface CreateConfigOptions {
  /** Directory holding the package's tsconfig.json (usually `import.meta.dirname`). */
  tsconfigRootDir: string;
  /** SPDX identifier every source file must declare on line 1. */
  license: License;
  /** Enables React hooks and JSX accessibility rules. */
  react?: boolean;
  /** Globs (relative to tsconfigRootDir) of files allowed to read `process.env`. */
  processEnvAllow?: string[];
  /** Package names this package must never import (license boundary). */
  forbiddenImports?: string[];
}

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const SOURCE_FILES = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
const TEST_FILES = ['**/*.{spec,test}.{ts,tsx}'];

export function createConfig(opts: CreateConfigOptions): Linter.Config[] {
  const {
    tsconfigRootDir,
    license,
    react = false,
    processEnvAllow = [],
    forbiddenImports = [],
  } = opts;

  return defineConfig(
    globalIgnores([
      '**/dist/**',
      '**/*.gen.ts',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
    ]),
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      name: '@app/eslint-config/base',
      files: SOURCE_FILES,
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: { ...globals.node, ...(react ? globals.browser : {}) },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: {
        'import-x': importX,
        unicorn,
        local: plugin,
      },
      settings: {
        'import-x/internal-regex': '^@app/',
        'import-x/resolver-next': [
          createTypeScriptImportResolver({ project: `${tsconfigRootDir}/tsconfig.json` }),
        ],
      },
      rules: {
        'no-console': 'error',
        eqeqeq: 'error',
        'no-restricted-syntax': [
          'error',
          {
            selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
            message:
              'dangerouslySetInnerHTML is banned; render text or sanitize through a vetted component.',
          },
          {
            selector: "Property[key.name='dangerouslySetInnerHTML']",
            message:
              'dangerouslySetInnerHTML is banned; render text or sanitize through a vetted component.',
          },
          {
            selector:
              "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(inner|outer)HTML$/]",
            message: 'Assigning innerHTML/outerHTML is banned; use textContent or DOM APIs.',
          },
        ],
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        'import-x/no-cycle': 'error',
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        'unicorn/prefer-node-protocol': 'error',
        // unicorn 79 renamed no-array-for-each to no-for-each.
        'unicorn/no-for-each': 'error',
        'unicorn/prefer-string-slice': 'error',
        'unicorn/throw-new-error': 'error',
        'local/spdx-header': ['error', { license }],
        'local/no-process-env': ['error', { allow: processEnvAllow, root: tsconfigRootDir }],
        'local/no-agpl-import': [
          forbiddenImports.length > 0 ? 'error' : 'off',
          { forbidden: forbiddenImports, forbiddenPathSegments: ['/apps/'] },
        ],
      },
    },
    {
      name: '@app/eslint-config/typed-local',
      files: TS_FILES,
      rules: {
        'local/tenant-repository': 'error',
      },
    },
    {
      // Plain JS, and eslint.config.ts, which sits outside each package's tsconfig
      // "include" (rootDir is src), are linted without type information.
      name: '@app/eslint-config/untyped',
      files: ['**/*.{js,mjs,cjs}', 'eslint.config.ts'],
      extends: [tseslint.configs.disableTypeChecked],
      rules: { 'local/tenant-repository': 'off' },
    },
    {
      name: '@app/eslint-config/tests',
      files: TEST_FILES,
      plugins: { vitest },
      rules: {
        ...vitest.configs.recommended.rules,
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    react
      ? [
          {
            name: '@app/eslint-config/react',
            files: ['**/*.{jsx,tsx}'],
            plugins: {
              'react-hooks': reactHooks as unknown as ESLint.Plugin,
              // jsx-a11y 6.10.2 declares eslint <= 9; the compat shim covers removed context APIs.
              'jsx-a11y': fixupPluginRules(jsxA11y),
            },
            languageOptions: {
              parserOptions: { ecmaFeatures: { jsx: true } },
            },
            rules: {
              ...reactHooks.configs.flat['recommended-latest'].rules,
              ...(jsxA11y.flatConfigs.recommended.rules as Linter.RulesRecord),
            },
          },
        ]
      : [],
  );
}
