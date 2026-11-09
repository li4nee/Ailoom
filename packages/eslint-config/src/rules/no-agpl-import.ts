// SPDX-License-Identifier: MIT
import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { createRule } from './create-rule.js';

export interface NoAgplImportOptions {
  /** Package names that must not be imported (the package itself or any subpath). */
  forbidden?: readonly string[];
  /** Path fragments that must not appear in an import specifier, e.g. `/apps/`. */
  forbiddenPathSegments?: readonly string[];
}

export const noAgplImport = createRule<[NoAgplImportOptions], 'agplImport'>({
  name: 'no-agpl-import',
  meta: {
    type: 'problem',
    docs: { description: 'Keep MIT packages from importing AGPL application code' },
    schema: [
      {
        type: 'object',
        properties: {
          forbidden: { type: 'array', items: { type: 'string' } },
          forbiddenPathSegments: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
    messages: {
      agplImport:
        '`{{source}}` is AGPL-licensed application code and must not be imported from an MIT package.',
    },
  },
  create(context, [options]) {
    const forbidden = options.forbidden ?? [];
    const segments = options.forbiddenPathSegments ?? [];

    const isForbidden = (source: string): boolean => {
      const normalized = source.replaceAll('\\', '/');
      return (
        forbidden.some((name) => normalized === name || normalized.startsWith(`${name}/`)) ||
        segments.some((segment) => normalized.includes(segment))
      );
    };

    const check = (node: TSESTree.Node | null | undefined): void => {
      if (
        node?.type === AST_NODE_TYPES.Literal &&
        typeof node.value === 'string' &&
        isForbidden(node.value)
      ) {
        context.report({ node, messageId: 'agplImport', data: { source: node.value } });
      }
    };

    return {
      ImportDeclaration: (node) => {
        check(node.source);
      },
      ExportAllDeclaration: (node) => {
        check(node.source);
      },
      ExportNamedDeclaration: (node) => {
        check(node.source);
      },
      ImportExpression: (node) => {
        check(node.source);
      },
      TSExternalModuleReference: (node) => {
        check(node.expression);
      },
      TSImportType: (node) => {
        check(node.source);
      },
      CallExpression: (node) => {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'require') {
          check(node.arguments[0]);
        }
      },
    };
  },
});
