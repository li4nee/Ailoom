// SPDX-License-Identifier: AGPL-3.0-only
import { PinoLogger } from 'nestjs-pino';

import { SecretBox } from '../../common/crypto';
import { type JobContext, type JobHandler, JobProcessor } from '../../jobs';
import { CredentialsRepository } from './credentials.repository';
import { CREDENTIALS_REENCRYPT_JOB, REENCRYPT_BATCH_SIZE } from './reencrypt.job';

/**
 * Runs in the worker after an operator adds a new key to `ENCRYPTION_KEYS` (spec §11.1):
 * decrypt with whichever key sealed the row, seal with the active one. A row whose key
 * version is no longer configured fails the job and is left untouched, so the operator can
 * put the old key back rather than lose the secret.
 */
@JobProcessor(CREDENTIALS_REENCRYPT_JOB)
export class ReencryptProcessor implements JobHandler<Record<string, never>> {
  constructor(
    private readonly repository: CredentialsRepository,
    private readonly secrets: SecretBox,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReencryptProcessor.name);
  }

  async handle(_payload: Record<string, never>, ctx: JobContext): Promise<void> {
    const keyVersion = this.secrets.activeKeyVersion;
    let rotated = 0;
    for (;;) {
      const batch = await this.repository.listStale(keyVersion, REENCRYPT_BATCH_SIZE);
      for (const row of batch) {
        if (
          row.secretCiphertext === null ||
          row.secretIv === null ||
          row.secretTag === null ||
          row.keyVersion === null
        ) {
          continue;
        }
        const plain = this.secrets.open({
          ciphertext: row.secretCiphertext,
          iv: row.secretIv,
          tag: row.secretTag,
          keyVersion: row.keyVersion,
        });
        await this.repository.reseal(row.id, this.secrets.seal(plain));
        rotated += 1;
      }
      if (batch.length < REENCRYPT_BATCH_SIZE) break;
    }
    this.logger.info({ jobId: ctx.jobId, rotated, keyVersion }, 'credentials re-encrypted');
  }
}
