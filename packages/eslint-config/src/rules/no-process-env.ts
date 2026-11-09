// SPDX-License-Identifier: MIT
import path from 'node:path';

import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import picomatch from 'picomatch';

import { createRule } from './create-rule.js';

export interface NoProcessEnvOptions {
  /** Globs (relative to `root`) of files allowed to read `process.env`. */
  allow?: readonly string[];
  /** Directory the globs are relative to. Defaults to ESLint's cwd. */
  root?: string;
}

function isNamed(node: TSESTree.Node, name: string): boolean {
  return (
    (node.type === AST_NODE_TYPES.Identifier && node.name === name) ||
    (node.type === AST_NODE_TYPES.Literal && node.value === name)
  );
}

function isEnvKey(property: TSESTree.Property | TSESTree.RestElement): boolean {
  return property.type === AST_NODE_TYPES.Property && isNamed(property.key, 'env');
}

export const noProcessEnv = createRule<[NoProcessEnvOptions], 'noProcessEnv'>({
  name: 'no-process-env',
  meta: {
    type: 'problem',
    docs: { description: 'Restrict `process.env` reads to the config module and entrypoints' },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
          root: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
    messages: {
      noProcessEnv: 'Read configuration through the typed config module instead of `process.env`.',
    },
  },
  create(context, [options]) {
    const root = options.root ?? context.cwd;
    const relative = path
      .relative(root, path.resolve(context.cwd, context.filename))
      .split(path.sep)
      .join('/');
    const allow = [...(options.allow ?? [])];
    if (allow.length > 0 && picomatch(allow, { dot: true })(relative)) {
      return {};
    }

    const reportPattern = (pattern: TSESTree.ObjectPattern): void => {
      for (const property of pattern.properties) {
        if (isEnvKey(property)) {
          context.report({ node: property, messageId: 'noProcessEnv' });
        }
      }
    };

    return {
      MemberExpression(node) {
        if (isNamed(node.object, 'process') && isNamed(node.property, 'env')) {
          if (node.computed && node.property.type === AST_NODE_TYPES.Identifier) {
            return;
          }
          context.report({ node, messageId: 'noProcessEnv' });
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type === AST_NODE_TYPES.ObjectPattern &&
          node.init !== null &&
          isNamed(node.init, 'process')
        ) {
          reportPattern(node.id);
        }
      },
      AssignmentExpression(node) {
        if (node.left.type === AST_NODE_TYPES.ObjectPattern && isNamed(node.right, 'process')) {
          reportPattern(node.left);
        }
      },
    };
  },
});
