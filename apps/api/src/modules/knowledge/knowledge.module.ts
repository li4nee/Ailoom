// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-node/multer/index.js';

import { Clock, SystemClock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { BotsModule } from '../bots';
import { DocumentsRepository } from './documents.repository';
import { SourcesController } from './sources.controller';
import { SourcesRepository } from './sources.repository';
import { SourcesService } from './sources.service';

/**
 * Knowledge sources and their documents. Job processors (ingestion, deletion, re-embedding)
 * live in the same module and run in the worker; the HTTP controllers run in the api.
 */
@Module({
  imports: [
    BotsModule,
    // The multipart upload is bounded by MAX_UPLOAD_MB (spec §12.1), read from the live config
    // rather than the environment so the e2e harness can lower it.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
      }),
    }),
  ],
  controllers: [SourcesController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    SourcesRepository,
    DocumentsRepository,
    SourcesService,
  ],
  exports: [SourcesRepository, DocumentsRepository, SourcesService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class KnowledgeModule {}
