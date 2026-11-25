// SPDX-License-Identifier: AGPL-3.0-only
import { evalCaseInputSchema, evalDatasetExportSchema, type EvalCaseInput } from '@app/shared';

import { AppError } from '../../common/errors';

export interface RagEvalFixtures {
  inScope: { q: string; expectedDoc: string }[];
  outOfScope: string[];
}

export function importRagFixtures(
  input: RagEvalFixtures,
  documentsByTitle: Map<string, string>,
): EvalCaseInput[] {
  const unknown = input.inScope
    .filter((item) => !documentsByTitle.has(item.expectedDoc))
    .map((item) => item.expectedDoc);
  if (unknown.length > 0) {
    throw new AppError('validation_failed', {
      details: [...new Set(unknown)].map((title) => ({
        path: 'inScope.expectedDoc',
        message: `Unknown document title: ${title}`,
      })),
    });
  }

  return [
    ...input.inScope.map((item) => {
      const documentId = documentsByTitle.get(item.expectedDoc);
      if (documentId === undefined) throw new AppError('validation_failed');
      return evalCaseInputSchema.parse({
        question: item.q,
        expectedDocumentIds: [documentId],
        origin: 'import',
      });
    }),
    ...input.outOfScope.map((question) =>
      evalCaseInputSchema.parse({ question, expectHandoff: true, origin: 'import' }),
    ),
  ];
}

export function parseEvalImport(
  input: unknown,
): { kind: 'export'; cases: EvalCaseInput[] } | { kind: 'rag'; fixtures: RagEvalFixtures } {
  const exported = evalDatasetExportSchema.safeParse(input);
  if (exported.success) return { kind: 'export', cases: exported.data.cases };

  if (typeof input !== 'object' || input === null) throw new AppError('validation_failed');
  const candidate = input as { inScope?: unknown; outOfScope?: unknown };
  if (!Array.isArray(candidate.inScope) || !Array.isArray(candidate.outOfScope)) {
    throw new AppError('validation_failed');
  }
  const inScope: RagEvalFixtures['inScope'] = [];
  for (const [index, raw] of candidate.inScope.entries()) {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as { q?: unknown }).q !== 'string' ||
      typeof (raw as { expectedDoc?: unknown }).expectedDoc !== 'string'
    ) {
      throw new AppError('validation_failed', {
        details: [{ path: `inScope.${String(index)}`, message: 'Expected q and expectedDoc.' }],
      });
    }
    inScope.push(raw as RagEvalFixtures['inScope'][number]);
  }
  if (candidate.outOfScope.some((q) => typeof q !== 'string')) {
    throw new AppError('validation_failed', {
      details: [{ path: 'outOfScope', message: 'Every out-of-scope item must be a question.' }],
    });
  }
  if (inScope.length + candidate.outOfScope.length > 500) {
    throw new AppError('validation_failed', {
      details: [{ path: 'cases', message: 'A dataset can contain at most 500 cases.' }],
    });
  }
  return { kind: 'rag', fixtures: { inScope, outOfScope: candidate.outOfScope as string[] } };
}

export function casesForExport(cases: EvalCaseInput[]): {
  format: 'ailoom-eval-dataset';
  version: 1;
  cases: EvalCaseInput[];
} {
  return evalDatasetExportSchema.parse({ format: 'ailoom-eval-dataset', version: 1, cases });
}
