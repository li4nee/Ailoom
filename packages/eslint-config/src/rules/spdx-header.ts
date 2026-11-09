// SPDX-License-Identifier: MIT
import type { TSESTree } from '@typescript-eslint/utils';

import { createRule } from './create-rule.js';

export interface SpdxHeaderOptions {
  license: string;
}

// The tag is split so REUSE does not read this source as a license declaration.
const TAG = 'SPDX-License-' + 'Identifier';
const HEADER_PATTERN = new RegExp(`^\\s*${TAG}:\\s*(\\S.*?)\\s*$`);

export const spdxHeader = createRule<[SpdxHeaderOptions], 'missingHeader' | 'wrongLicense'>({
  name: 'spdx-header',
  meta: {
    type: 'problem',
    docs: { description: 'Require an SPDX license header as the first line of every source file' },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: { license: { type: 'string', minLength: 1 } },
        required: ['license'],
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ license: 'MIT' }],
    messages: {
      missingHeader: 'The file must start with `// {{tag}}: {{license}}`.',
      wrongLicense: 'Expected license {{expected}} in the SPDX header, found {{actual}}.',
    },
  },
  create(context, [{ license }]) {
    const sourceCode = context.sourceCode;
    return {
      Program(node) {
        const comments = sourceCode.getAllComments();
        // A shebang must stay on line 1; the header then goes right after it.
        // ESLint reports a leading `#!` line as a comment of type "Shebang".
        const isShebang = (comment: TSESTree.Comment | undefined): boolean =>
          (comment?.type as string | undefined) === 'Shebang';
        const shebang = isShebang(comments[0]) ? comments[0] : undefined;
        const headerStart = shebang === undefined ? 0 : shebang.range[1] + 1;
        const first = comments.find((comment) => !isShebang(comment));
        const match = first?.range[0] === headerStart ? HEADER_PATTERN.exec(first.value) : null;

        if (first === undefined || match === null) {
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: 'missingHeader',
            data: { tag: TAG, license },
            fix: (fixer) =>
              shebang === undefined
                ? fixer.insertTextBeforeRange([0, 0], `// ${TAG}: ${license}\n`)
                : fixer.insertTextAfterRange(shebang.range, `\n// ${TAG}: ${license}`),
          });
          return;
        }

        const actual = match[1];
        if (actual !== license) {
          context.report({
            loc: first.loc,
            messageId: 'wrongLicense',
            data: { expected: license, actual },
          });
        }
      },
    };
  },
});
