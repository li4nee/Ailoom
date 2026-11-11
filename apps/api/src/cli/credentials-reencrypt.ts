// SPDX-License-Identifier: AGPL-3.0-only
// Rotates credential secrets onto the newest master key (spec §11.1):
//   node dist/cli/credentials-reencrypt.js
// Add the new key first in ENCRYPTION_KEYS, restart the services, then run this.
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { ConfigModule, loadConfig } from '../common/config';
import { JobsService, JobsModule } from '../jobs';
import { CREDENTIALS_REENCRYPT_JOB } from '../modules/credentials/reencrypt.job';

export interface ReencryptDeps {
  jobs: Pick<JobsService, 'enqueue'>;
  write: (line: string) => void;
}

/** Enqueues the rotation job; the worker does the rewriting. Returns the exit code. */
export async function enqueueReencrypt(deps: ReencryptDeps): Promise<number> {
  try {
    const jobId = await deps.jobs.enqueue(
      CREDENTIALS_REENCRYPT_JOB,
      {},
      // One pending rotation at a time: a second run would duplicate the whole walk.
      { singletonKey: 'credentials.reencrypt' },
    );
    deps.write(jobId === null ? 'already queued' : `enqueued ${jobId}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.write(`credentials-reencrypt: ${message}`);
    return 1;
  }
}

async function main(): Promise<number> {
  // Declared here so importing this file (tests) never reads the environment.
  // Only the send side of pg-boss: the worker owns processing.
  @Module({
    imports: [ConfigModule.forRoot(loadConfig(process.env)), JobsModule.forApi()],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
  class ReencryptCliModule {}

  const app = await NestFactory.createApplicationContext(ReencryptCliModule, { logger: false });
  try {
    return await enqueueReencrypt({
      jobs: app.get(JobsService),
      write: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await app.close();
  }
}

// Runs when started as `node dist/cli/credentials-reencrypt.js`, not when imported (tests).
if (typeof require !== 'undefined' && require.main === module) {
  void main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      Logger.error(error, 'credentials-reencrypt');
      process.exitCode = 1;
    });
}
