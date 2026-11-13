// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { APP_CONFIG, type AppConfig } from '../../../common/config';
import type { FetchPolicy } from '../../../common/safe-fetch';
import { FILE_STORAGE, type FileStorage } from '../../../common/storage';
import { asWorkspaceId } from '../../../db/ids';
import { type JobHandler, JobProcessor, JobsService } from '../../../jobs';
import { BotsRepository } from '../../bots';
import { discoverUrls } from '../crawl/discover';
import { DocumentsRepository } from '../documents.repository';
import type { KnowledgeSourceEntity } from '../entities/knowledge-source.entity';
import { errorMessageFor, IngestFailure } from '../errors';
import {
  extractDocx,
  extractHtml,
  extractPdf,
  extractPlain,
  ExtractError,
  type ExtractResult,
} from '../extract';
import { EMBED_CHUNKS_JOB, INGEST_PAGE_JOB, INGEST_SOURCE_JOB } from '../knowledge.jobs';
import { SourcesRepository } from '../sources.repository';
import { CRAWL_FETCH_POLICY, FETCH_DEPS, fetchPage, type FetchDeps } from './fetch-page';
import { ProgressService } from './progress.service';
import { VersioningService } from './versioning.service';

export interface IngestSourcePayload {
  workspaceId: string;
  sourceId: string;
}

/** An uploaded HTML file has no public URL; links inside it are made absolute against this. */
const UPLOAD_BASE_URL = 'https://upload.invalid/';

/**
 * Resolves a source into pages and document versions (spec §12.2). Text and file sources are
 * extracted right here; URL and sitemap sources enqueue one `knowledge.ingest_page` per page so
 * each fetch has its own retry and concurrency slot.
 *
 * Every run first re-checks that the source and its bot still exist: a job that outlived them
 * exits quietly instead of recreating rows (spec §12.2, deletion §12.8).
 */
@Injectable()
@JobProcessor(INGEST_SOURCE_JOB)
export class IngestSourceProcessor implements JobHandler<IngestSourcePayload> {
  private readonly logger = new Logger(IngestSourceProcessor.name);

  constructor(
    private readonly ds: DataSource,
    private readonly sources: SourcesRepository,
    private readonly documents: DocumentsRepository,
    private readonly versions: VersioningService,
    private readonly progress: ProgressService,
    private readonly bots: BotsRepository,
    private readonly jobs: JobsService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CRAWL_FETCH_POLICY) private readonly policy: FetchPolicy,
    @Inject(FETCH_DEPS) private readonly fetchDeps: FetchDeps,
  ) {}

  async handle(payload: IngestSourcePayload): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const source = await this.sources.findById(workspaceId, payload.sourceId);
    if (source === null) return;
    if (source.status === 'deleting') return;
    const bot = await this.bots.findById(workspaceId, source.botId);
    if (bot === null) return;
    if (bot.deletedAt !== null) return;

    await this.ds.transaction(async (manager) => {
      await this.sources.setStatus(manager, workspaceId, payload.sourceId, 'processing');
      await this.sources.resetProgress(manager, workspaceId, payload.sourceId);
    });

    try {
      switch (source.type) {
        case 'text':
        case 'file': {
          const extract = await this.extractSource(source);
          await this.record(source, extract, bot.embeddingModel);
          return;
        }
        case 'url': {
          await this.enqueuePages(source, source.sourceUrl === null ? [] : [source.sourceUrl]);
          return;
        }
        case 'sitemap': {
          await this.ingestSitemap(source);
          return;
        }
        default:
          throw new IngestFailure('unsupported_content');
      }
    } catch (error) {
      await this.fail(source, error);
    }
  }

  private async extractSource(source: KnowledgeSourceEntity): Promise<ExtractResult> {
    if (source.type === 'text') {
      const body = source.options['body'];
      if (typeof body !== 'string') throw new IngestFailure('empty_content');
      return extractPlain(body, 'markdown', source.title);
    }

    if (source.fileKey === null) throw new IngestFailure('empty_content');
    const stream = await this.storage.get(source.fileKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    const data = Buffer.concat(chunks);

    switch (source.options['detectedType']) {
      case 'pdf':
        return extractPdf(data, { maxPages: this.config.crawl.maxPages });
      case 'docx':
        return extractDocx(data);
      case 'html':
        return extractHtml(data.toString('utf8'), UPLOAD_BASE_URL);
      case 'markdown':
        return extractPlain(data.toString('utf8'), 'markdown', source.title);
      case 'text':
        return extractPlain(data.toString('utf8'), 'text', source.title);
      default:
        throw new IngestFailure('unsupported_content');
    }
  }

  private async ingestSitemap(source: KnowledgeSourceEntity): Promise<void> {
    if (source.sourceUrl === null) throw new IngestFailure('blocked_url');
    const found = await discoverUrls(
      source.sourceUrl,
      {
        maxPages: numberOption(source.options['maxPages'], this.config.crawl.maxPages),
        include: stringArray(source.options['includePatterns']),
        exclude: stringArray(source.options['excludePatterns']),
        respectRobots: this.config.crawl.respectRobots,
        userAgent: this.policy.userAgent,
      },
      (url) => fetchPage(url, this.policy, this.fetchDeps),
    );
    if (found.urls.length === 0) {
      throw new IngestFailure('empty_content');
    }
    await this.enqueuePages(source, found.urls);
  }

  /** One page job per URL, with the total set in the same transaction that writes the jobs. */
  private async enqueuePages(source: KnowledgeSourceEntity, urls: string[]): Promise<void> {
    await this.ds.transaction(async (manager) => {
      await this.progress.setTotal(manager, source.workspaceId, source.id, urls.length);
      for (const url of urls) {
        await this.jobs.enqueue(
          INGEST_PAGE_JOB,
          {
            workspaceId: source.workspaceId,
            sourceId: source.id,
            documentId: null,
            url,
          },
          { manager, singletonKey: `page:${source.id}:${url}` },
        );
      }
    });
  }

  private async record(
    source: KnowledgeSourceEntity,
    extract: ExtractResult,
    embeddingModel: string,
  ): Promise<void> {
    const documentId = await this.ds.transaction(async (manager) => {
      const id = await this.documents.upsertRoot(manager, {
        workspaceId: source.workspaceId,
        botId: source.botId,
        sourceId: source.id,
        title: extract.title ?? source.title,
      });
      await this.documents.setTitle(manager, source.workspaceId, id, extract.title);
      await this.progress.setTotal(manager, source.workspaceId, source.id, 1);
      return id;
    });

    const recorded = await this.versions.recordContent(source.workspaceId, documentId, extract);
    if (!recorded.changed) {
      await this.progress.pageDone(source.workspaceId, source.id, { ok: true, warnings: 0 });
      return;
    }

    await this.ds.transaction(async (manager) => {
      await this.jobs.enqueue(
        EMBED_CHUNKS_JOB,
        {
          workspaceId: source.workspaceId,
          botId: source.botId,
          documentVersionId: recorded.versionId,
          embeddingModel,
        },
        { manager, singletonKey: `embed:${recorded.versionId}:${embeddingModel}` },
      );
    });
    await this.progress.pageDone(source.workspaceId, source.id, {
      ok: true,
      warnings: extract.warnings.length > 0 ? 1 : 0,
    });
  }

  private async fail(source: KnowledgeSourceEntity, error: unknown): Promise<void> {
    if (error instanceof ExtractError || error instanceof IngestFailure) {
      await this.progress.fail(source.workspaceId, source.id, errorMessageFor(error.code));
      return;
    }
    this.logger.error(
      `ingest source ${source.id} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
