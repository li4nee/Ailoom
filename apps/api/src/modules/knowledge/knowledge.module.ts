// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-node/multer/index.js';

import { Clock, SystemClock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { crawlPolicy, type FetchPolicy } from '../../common/safe-fetch';
import { BotsModule } from '../bots';
import { CredentialsModule } from '../credentials';
import { UsageModule } from '../usage';
import { WorkspacesModule } from '../workspaces';
import { ChunksRepository } from './chunks.repository';
import { DomainSlots } from './crawl/domain-slots';
import { DeleteSourceProcessor } from './delete-source.processor';
import { DeletionRepository } from './deletion.repository';
import { DeletionService } from './deletion.service';
import { DocumentsRepository } from './documents.repository';
import { FreshnessController } from './freshness/freshness.controller';
import { FreshnessRepository } from './freshness/freshness.repository';
import { RecrawlScheduleService } from './freshness/recrawl-schedule.service';
import { RecrawlSchedulerProcessor } from './freshness/recrawl-scheduler.processor';
import { EmbedChunksProcessor } from './ingest/embed-chunks.processor';
import { EmbedVersionService } from './ingest/embed-version.service';
import { CRAWL_FETCH_POLICY, FETCH_DEPS, type FetchDeps } from './ingest/fetch-page';
import { IngestPageProcessor } from './ingest/ingest-page.processor';
import { IngestSourceProcessor } from './ingest/ingest-source.processor';
import { ProgressService } from './ingest/progress.service';
import { RobotsService } from './ingest/robots.service';
import { VersioningService } from './ingest/versioning.service';
import { PurgeBotKnowledgeProcessor } from './purge-bot-knowledge.processor';
import { ReembedBotProcessor } from './reembed/reembed-bot.processor';
import { ReembedRepository } from './reembed/reembed.repository';
import { ReembedService } from './reembed/reembed.service';
import { SourcesController } from './sources.controller';
import { SourcesRepository } from './sources.repository';
import { SourcesService } from './sources.service';
import { SuggestionsController } from './suggestions.controller';
import { SuggestionsRepository } from './suggestions.repository';
import { SuggestionsService } from './suggestions.service';
import { VersionsRepository } from './versions.repository';

export interface KnowledgeModuleOptions {
  /** Test seam: a policy that allows a fixture server instead of the public crawl policy. */
  fetchPolicy?: FetchPolicy;
  /** Test seam: a lookup mapping a fixture host name to a local server. */
  fetchDeps?: FetchDeps;
}

/**
 * Knowledge sources, their documents and the jobs that index them. The processors are
 * providers like any other; only the worker app imports this module into a graph that runs
 * pg-boss, so the api process never executes them.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class KnowledgeModule {
  static register(options: KnowledgeModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: Clock, useClass: SystemClock },
      {
        provide: CRAWL_FETCH_POLICY,
        inject: [APP_CONFIG],
        useFactory: (config: AppConfig) => options.fetchPolicy ?? crawlPolicy(config),
      },
      { provide: FETCH_DEPS, useValue: options.fetchDeps ?? {} },
      SourcesRepository,
      FreshnessRepository,
      DocumentsRepository,
      VersionsRepository,
      ChunksRepository,
      SourcesService,
      SuggestionsRepository,
      SuggestionsService,
      VersioningService,
      ProgressService,
      RobotsService,
      EmbedVersionService,
      ReembedRepository,
      ReembedService,
      DomainSlots,
      DeletionRepository,
      DeletionService,
      IngestSourceProcessor,
      IngestPageProcessor,
      RecrawlSchedulerProcessor,
      RecrawlScheduleService,
      EmbedChunksProcessor,
      DeleteSourceProcessor,
      PurgeBotKnowledgeProcessor,
      ReembedBotProcessor,
    ];

    return {
      module: KnowledgeModule,
      imports: [
        BotsModule,
        CredentialsModule,
        UsageModule,
        WorkspacesModule,
        // The multipart upload is bounded by MAX_UPLOAD_MB (spec §12.1), read from the live
        // config rather than the environment so the e2e harness can lower it.
        MulterModule.registerAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => ({
            limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
          }),
        }),
      ],
      controllers: [SourcesController, SuggestionsController, FreshnessController],
      providers,
      exports: [
        SourcesRepository,
        DocumentsRepository,
        VersionsRepository,
        ChunksRepository,
        SourcesService,
        SuggestionsService,
        VersioningService,
        ProgressService,
        DeletionService,
        ReembedService,
      ],
    };
  }
}
