// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

const runPayload = z.object({ runId: z.uuid(), workspaceId: z.uuid() });

export const EVAL_RUN_JOB = defineJob({
  name: 'eval.run',
  schema: runPayload,
  retryLimit: 1,
  retryBackoff: false,
  concurrency: 3,
  expireInSec: 60 * 60,
});

export const EVAL_CASE_JOB = defineJob({
  name: 'eval.case',
  schema: runPayload.extend({ caseIndex: z.number().int().nonnegative() }),
  retryLimit: 0,
  retryBackoff: false,
  concurrency: 4,
  expireInSec: 10 * 60,
});

export type EvalRunPayload = z.infer<typeof runPayload>;
export type EvalCasePayload = z.infer<typeof EVAL_CASE_JOB.schema>;
