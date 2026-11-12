// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/**
 * Re-seals every credential with the active master key (spec §11.1 rotation). One run at a
 * time: two rotations racing would rewrite each other's rows, and a second attempt after a
 * partial run simply continues where the first stopped.
 */
export const CREDENTIALS_REENCRYPT_JOB = defineJob({
  name: 'credentials.reencrypt',
  schema: z.object({}),
  retryLimit: 1,
  retryBackoff: true,
  concurrency: 1,
});

/** Rows re-sealed per round trip; the job keeps going until a batch comes back short. */
export const REENCRYPT_BATCH_SIZE = 100;
