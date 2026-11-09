// SPDX-License-Identifier: AGPL-3.0-only
import { createConfig } from '@app/eslint-config';

export default [
  ...createConfig({
    tsconfigRootDir: import.meta.dirname,
    license: 'AGPL-3.0-only',
    processEnvAllow: [
      'src/common/config/**',
      'src/main.ts',
      'src/worker.ts',
      'src/migrate.ts',
      'src/cli/**',
      'src/db/cli-data-source.ts',
    ],
  }),
  {
    // verbatimModuleSyntax is off here (CommonJS output), so type-only imports are
    // enforced by lint instead. Decorator metadata awareness keeps Nest
    // constructor-injected classes as value imports.
    name: '@app/api/type-imports',
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
    },
  },
];
