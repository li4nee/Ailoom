// SPDX-License-Identifier: AGPL-3.0-only
/** Dependency rules for apps/api (architecture §4). `pnpm --filter @app/api depcruise`. */
module.exports = {
  // The layering rules govern production code. Tests (`*.spec.ts`) may reach into any layer
  // to check it; cycles, the AI SDK boundary and test-helper imports apply to everything.
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Runtime import cycles leave one side undefined while the other initializes.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'common-is-leaf',
      comment: 'src/common holds cross-cutting helpers; it depends on nothing app-specific.',
      severity: 'error',
      from: { path: '^src/common/', pathNot: '\\.spec\\.ts$' },
      to: { path: '^src/(db|modules|providers|jobs|app)/' },
    },
    {
      name: 'db-only-common',
      comment: 'src/db is infrastructure: it may use src/common, never features or the app.',
      severity: 'error',
      from: { path: '^src/db/', pathNot: '\\.spec\\.ts$' },
      to: { path: '^src/(modules|providers|jobs|app)/' },
    },
    {
      name: 'module-public-surface',
      comment: 'A feature module reaches another only through its index.ts.',
      severity: 'error',
      // TypeORM entities must import relation targets directly so metadata initialization does
      // not create runtime cycles through feature index files. The guard's repository dependency
      // is also an intentional authentication boundary, not a feature implementation leak.
      from: {
        path: '^src/modules/([^/]+)/',
        pathNot: '\\.spec\\.ts$|\\.entity\\.ts$|^src/modules/auth/access\\.guard\\.ts$',
      },
      to: { path: '^src/modules/(?!$1/)[^/]+/(?!index\\.ts$)' },
    },
    {
      name: 'ai-sdk-in-providers-only',
      comment: 'Only src/providers/ may import ai / @ai-sdk/*; everything else calls Llm.',
      severity: 'error',
      from: { pathNot: '^src/providers/' },
      to: { path: '(^|/)node_modules/(ai|@ai-sdk/[^/]+)/' },
    },
    {
      name: 'no-test-imports-in-src',
      comment: 'Production code under src/ never imports test helpers.',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.spec\\.ts$' },
      to: { path: '^test/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|coverage)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Count type-only imports too: they compile away, but a layer or a module boundary that
    // only holds for runtime imports is not a boundary, and a cycle of types is still a cycle.
    tsPreCompilationDeps: true,
  },
};
