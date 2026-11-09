// SPDX-License-Identifier: AGPL-3.0-only
module.exports = {
  $schema:
    'https://raw.githubusercontent.com/sverweij/dependency-cruiser/master/src/schema/dependency-cruiser.schema.json',
  forbidden: [
    {
      name: 'ai-sdk-in-providers-only',
      comment: 'Only src/providers/ may import ai / @ai-sdk/*.',
      severity: 'error',
      from: { path: '^src/(?!providers/).*\\.[tj]s$' },
      to: { path: '^(ai|@ai-sdk/)' },
    },
    {
      name: 'no-test-imports-in-src',
      comment: 'src/ production files may not import from test/.',
      severity: 'error',
      from: { path: '^src/(?!.*\\.spec\\.[tj]s$).*\\.[tj]s$' },
      to: { path: '^test/' },
    },
  ],
};
