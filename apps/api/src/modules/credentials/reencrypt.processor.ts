// SPDX-License-Identifier: AGPL-3.0-only
import { Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

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
    @Optional() private readonly ds?: DataSource,
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
          // `listStale` already excludes these; the check narrows the types.
          continue;
        }
        const previous = {
          ciphertext: row.secretCiphertext,
          iv: row.secretIv,
          tag: row.secretTag,
          keyVersion: row.keyVersion,
        };
        const plain = this.secrets.open(previous);
        // False when an admin saved a new key since the read: theirs is already current.
        if (await this.repository.reseal(row.id, previous, this.secrets.seal(plain))) rotated += 1;
      }
      if (batch.length < REENCRYPT_BATCH_SIZE) break;
    }
    const toolSecretsRotated = this.ds === undefined ? 0 : await this.reencryptToolSecrets();
    this.logger.info(
      { jobId: ctx.jobId, rotated, toolSecretsRotated, keyVersion },
      'credentials re-encrypted',
    );
  }

  private async reencryptToolSecrets(): Promise<number> {
    if (this.ds === undefined) return 0;
    let rotated = 0;
    for (;;) {
      const batch = await this.ds.query<
        {
          workspace_id: string;
          tool_id: string;
          version: number;
          ciphertext: Buffer;
          iv: Buffer;
          tag: Buffer;
          key_version: number;
        }[]
      >(
        `SELECT workspace_id, tool_id, version, ciphertext, iv, tag, key_version
           FROM bot_tool_auth_secrets
          WHERE key_version <> $1
          ORDER BY workspace_id, tool_id, version
          LIMIT $2`,
        [this.secrets.activeKeyVersion, REENCRYPT_BATCH_SIZE],
      );
      for (const row of batch) {
        const previous = {
          ciphertext: row.ciphertext,
          iv: row.iv,
          tag: row.tag,
          keyVersion: row.key_version,
        };
        const sealed = this.secrets.seal(this.secrets.open(previous));
        const [, affected] = await this.ds.query<[unknown[], number]>(
          `UPDATE bot_tool_auth_secrets
              SET ciphertext = $5, iv = $6, tag = $7, key_version = $8
            WHERE workspace_id = $1 AND tool_id = $2 AND version = $3 AND key_version = $4`,
          [
            row.workspace_id,
            row.tool_id,
            row.version,
            row.key_version,
            sealed.ciphertext,
            sealed.iv,
            sealed.tag,
            sealed.keyVersion,
          ],
        );
        if (affected > 0) rotated += 1;
      }
      if (batch.length < REENCRYPT_BATCH_SIZE) return rotated;
    }
  }
}
