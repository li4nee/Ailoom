// SPDX-License-Identifier: MIT
import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import ts from 'typescript';

import { createRule } from './create-rule.js';

export interface TenantRepositoryOptions {
  /** Repository methods that bypass workspace scoping when called directly. */
  methods?: readonly string[];
}

export const DEFAULT_TENANT_METHODS = [
  'findOne',
  'findOneBy',
  'findOneOrFail',
  'findOneByOrFail',
  'find',
  'findBy',
  'findAndCount',
  'findAndCountBy',
  'count',
  'countBy',
  'exists',
  'existsBy',
  'update',
  'delete',
  'softDelete',
  'restore',
  'save',
  'insert',
  'upsert',
  'remove',
  'softRemove',
  'increment',
  'decrement',
  'createQueryBuilder',
];

const REPOSITORY_SUFFIX = '.repository.ts';

/** Tests seed rows through raw repositories, outside every service boundary. */
export function isTestFile(filename: string, cwd: string): boolean {
  const normalized = filename.replaceAll('\\', '/');
  const root = cwd.replaceAll('\\', '/');
  return normalized.endsWith('.spec.ts') || normalized.startsWith(`${root}/test/`);
}

/** Returns the entity type when `type` is `Repository<T>`, else undefined. */
function repositoryEntity(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
  const apparent = checker.getApparentType(type);
  const alias = apparent.aliasSymbol;
  if (alias?.getName() === 'Repository' && apparent.aliasTypeArguments?.length === 1) {
    return apparent.aliasTypeArguments[0];
  }
  if (apparent.getSymbol()?.getName() !== 'Repository') {
    return undefined;
  }
  if (
    (apparent.flags & ts.TypeFlags.Object) === 0 ||
    ((apparent as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) === 0
  ) {
    return undefined;
  }
  const args = checker.getTypeArguments(apparent as ts.TypeReference);
  return args.length === 1 ? args[0] : undefined;
}

export const tenantRepository = createRule<[TenantRepositoryOptions], 'tenantRepositoryOnly'>({
  name: 'tenant-repository',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Tenant entities (with a workspaceId) are only queried inside *.repository.ts files',
      requiresTypeChecking: true,
    },
    schema: [
      {
        type: 'object',
        properties: { methods: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
    messages: {
      tenantRepositoryOnly:
        '`{{method}}` on a Repository of a tenant entity must go through a TenantRepository subclass in a *.repository.ts file.',
    },
  },
  create(context, [options]) {
    if (context.filename.endsWith(REPOSITORY_SUFFIX) || isTestFile(context.filename, context.cwd)) {
      return {};
    }
    const methods = new Set(options.methods ?? DEFAULT_TENANT_METHODS);
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          !methods.has(callee.property.name)
        ) {
          return;
        }
        const entity = repositoryEntity(checker, services.getTypeAtLocation(callee.object));
        if (entity?.getProperty('workspaceId') === undefined) {
          return;
        }
        context.report({
          node: callee.property,
          messageId: 'tenantRepositoryOnly',
          data: { method: callee.property.name },
        });
      },
    };
  },
});
