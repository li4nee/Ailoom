// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Clock } from '../../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../../common/config';
import type { FetchPolicy } from '../../../common/safe-fetch';
import { asWorkspaceId } from '../../../db/ids';
import { type JobHandler, JobProcessor, JobsService } from '../../../jobs';
import { BotsRepository } from '../../bots';
import { DomainSlots } from '../crawl/domain-slots';
import { normalizeCrawlUrl } from '../crawl/url-normalize';
import { DocumentsRepository } from '../documents.repository';
import type { KnowledgeSourceEntity } from '../entities/knowledge-source.entity';
import { errorMessageFor, IngestFailure } from '../errors';
import {
  extractHtml,
  extractPdf,
  extractPlain,
  ExtractError,
  type ExtractResult,
} from '../extract';
import { EMBED_CHUNKS_JOB, INGEST_PAGE_JOB } from '../knowledge.jobs';
import { SourcesRepository } from '../sources.repository';
import {
  CRAWL_FETCH_POLICY,
  FETCH_DEPS,
  fetchPage,
  kindOf,
  type FetchDeps,
  type FetchedPage,
} from './fetch-page';
import { ProgressService } from './progress.service';
import { RobotsService } from './robots.service';
import { VersioningService } from './versioning.service';

export interface IngestPagePayload {
  workspaceId: string;
  sourceId: string;
  documentId: string | null;
  url: string | null;
}

/** Re-queued rather than failed when both per-domain slots are busy (spec §12.1). */
const BUSY_RETRY_SECONDS = 5;

/**
 * Fetches, extracts and records one page (spec §12.2). A page that cannot be indexed for a
 * reason the site owns (404, blocked address, a scan) counts as failed for its source; a
 * transient failure throws, so pg-boss retries it with backoff.
 */
@Injectable()
@JobProcessor(INGEST_PAGE_JOB)
export class IngestPageProcessor implements JobHandler<IngestPagePayload> {
  private readonly logger = new Logger(IngestPageProcessor.name);

  constructor(
    private readonly ds: DataSource,
    private readonly sources: SourcesRepository,
    private readonly documents: DocumentsRepository,
    private readonly versions: VersioningService,
    private readonly progress: ProgressService,
    private readonly bots: BotsRepository,
    private readonly jobs: JobsService,
    private readonly slots: DomainSlots,
    private readonly robots: RobotsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CRAWL_FETCH_POLICY) private readonly policy: FetchPolicy,
    @Inject(FETCH_DEPS) private readonly fetchDeps: FetchDeps,
  ) {}

  async handle(payload: IngestPagePayload): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const source = await this.sources.findById(workspaceId, payload.sourceId);
    if (source === null) return;
    if (source.status === 'deleting') return;
    const bot = await this.bots.findById(workspaceId, source.botId);
    if (bot === null) return;
    if (bot.deletedAt !== null) return;

    if (payload.url === null) {
      // A document without a URL is a text/file source, handled by ingest.source.
      if (payload.documentId !== null) return;
      await this.progress.pageDone(workspaceId, source.id, {
        ok: false,
        warnings: 0,
        error: errorMessageFor('empty_content'),
      });
      return;
    }

    const url = payload.url;
    const domain = new URL(url).hostname;
    const outcome = await this.slots.withSlot(domain, async () => {
      await this.ingestPage(source, bot.embeddingModel, url, payload.documentId);
    });
    if (outcome === 'busy') {
      // Not a failure: the page waits its turn instead of spending a retry.
      await this.ds.transaction(async (manager) => {
        await this.jobs.enqueue(INGEST_PAGE_JOB, payload, {
          manager,
          startAfter: BUSY_RETRY_SECONDS,
          singletonKey: `page:${source.id}:${url}`,
        });
      });
    }
  }

  private async ingestPage(
    source: KnowledgeSourceEntity,
    embeddingModel: string,
    url: string,
    documentId: string | null,
  ): Promise<void> {
    try {
      if (source.type === 'sitemap' && this.config.crawl.respectRobots) {
        if (!(await this.robots.allowed(url, this.policy.userAgent))) {
          await this.progress.pageDone(source.workspaceId, source.id, {
            ok: true,
            warnings: 0,
          });
          return;
        }
      }

      const page = await fetchPage(url, this.policy, this.fetchDeps);
      const extract = await this.extract(page, source.title);
      await this.record(source, embeddingModel, page.finalUrl, extract, documentId);
    } catch (error) {
      if (error instanceof ExtractError || error instanceof IngestFailure) {
        if (error instanceof IngestFailure && error.marksUnreachable) {
          const canonical = normalizeCrawlUrl(url);
          const document =
            documentId === null
              ? await this.documents.findByUrl(source.workspaceId, source.id, canonical)
              : await this.documents.findById(source.workspaceId, documentId);
          if (document !== null) {
            await this.documents.markUnreachable(source.workspaceId, document.id, this.clock.now());
            await this.progress.pageDone(source.workspaceId, source.id, {
              ok: true,
              warnings: 0,
            });
            return;
          }
        }
        await this.progress.pageDone(source.workspaceId, source.id, {
          ok: false,
          warnings: 0,
          error: errorMessageFor(error.code),
        });
        return;
      }
      this.logger.warn(
        `page ${url} failed transiently: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async extract(page: FetchedPage, fallbackTitle: string): Promise<ExtractResult> {
    const kind = kindOf(page.contentType);
    switch (kind) {
      case 'html':
        return extractHtml(page.body.toString('utf8'), page.finalUrl);
      case 'text':
        return extractPlain(page.body.toString('utf8'), 'text', fallbackTitle);
      case 'markdown':
        return extractPlain(page.body.toString('utf8'), 'markdown', fallbackTitle);
      case 'pdf':
        return extractPdf(page.body, { maxPages: this.config.crawl.maxPages });
      case null:
        throw new IngestFailure('bad_content_type');
      default:
        throw new IngestFailure('bad_content_type');
    }
  }

  private async record(
    source: KnowledgeSourceEntity,
    embeddingModel: string,
    finalUrl: string,
    extract: ExtractResult,
    documentId: string | null,
  ): Promise<void> {
    const canonical = normalizeCrawlUrl(finalUrl);
    const checkedAt = this.clock.now();
    const id = await this.ds.transaction(async (manager) => {
      let resolvedDocumentId: string;
      if (documentId !== null) {
        await this.documents.setTitle(manager, source.workspaceId, documentId, extract.title);
        resolvedDocumentId = documentId;
      } else {
        const inserted = await this.documents.insertIfNew(manager, {
          workspaceId: source.workspaceId,
          botId: source.botId,
          sourceId: source.id,
          url: canonical,
          title: extract.title ?? source.title,
        });
        resolvedDocumentId = inserted.id;
        await this.documents.setTitle(manager, source.workspaceId, inserted.id, extract.title);
      }
      await this.documents.markChecked(source.workspaceId, resolvedDocumentId, checkedAt, manager);
      return resolvedDocumentId;
    });

    const recorded = await this.versions.recordContent(source.workspaceId, id, extract);
    if (!recorded.changed) {
      await this.progress.pageDone(source.workspaceId, source.id, { ok: true, warnings: 0 });
      return;
    }

    if (extract.warnings.includes('low_text_content')) {
      await this.versions.swapCurrentVersion(source.workspaceId, id, recorded.versionId);
      await this.progress.pageDone(source.workspaceId, source.id, {
        ok: true,
        warnings: 1,
      });
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
}
