// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { ZodError } from 'zod';

import {
  CRAWL_MAX_PAGES_DEFAULT,
  createSourceSchema,
  TEXT_SOURCE_MAX_BYTES,
  type CreateSourceRequest,
  type RecrawlInterval,
  updateSourceSchema,
  type UpdateSourceRequest,
  freshnessQuerySchema,
  type FreshnessQuery,
  type DocumentVersionDto,
  type FreshnessItemDto,
  type VersionDiffDto,
  manualDocumentContentSchema,
  type ManualDocumentContentRequest,
} from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { classifyIp, parseTarget } from '../../common/safe-fetch';
import {
  detectFileType,
  FILE_STORAGE,
  newStorageKey,
  type DetectedFileType,
  type FileStorage,
} from '../../common/storage';
import type { SourceId, UserId, WorkspaceId } from '../../db/ids';
import { decodeCursor } from '../../db/pagination';
import { JobsService } from '../../jobs';
import type { BotEntity } from '../bots';
import { BotsService } from '../bots';
import { notifyWorkspace } from '../realtime';
import { ChunksRepository } from './chunks.repository';
import { DocumentsRepository } from './documents.repository';
import { contentHash } from './domain/content-hash';
import { normalizeMarkdown } from './domain/normalize';
import type { KnowledgeSourceEntity } from './entities/knowledge-source.entity';
import { FreshnessRepository } from './freshness/freshness.repository';
import { diffVersions } from './freshness/version-diff';
import { VersioningService } from './ingest/versioning.service';
import { DELETE_SOURCE_JOB, INGEST_SOURCE_JOB } from './knowledge.jobs';
import { EMBED_CHUNKS_JOB } from './knowledge.jobs';
import { SourcesRepository } from './sources.repository';
import { VersionsRepository } from './versions.repository';

/** What one uploaded file needs to become a `file` source. */
export interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

const MIME_BY_TYPE: Record<DetectedFileType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  markdown: 'text/markdown',
  text: 'text/plain',
};

function validationError(error: ZodError): AppError {
  return new AppError('validation_failed', {
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

/**
 * A private or loopback IP literal is rejected before anything is stored (spec §12.1). Host
 * names are only resolved when the crawl fetches them, through `safeFetch`, which checks every
 * address it connects to.
 */
function assertFetchable(rawUrl: string): void {
  let target;
  try {
    target = parseTarget(rawUrl);
  } catch {
    throw new AppError('validation_failed', {
      details: [{ path: 'url', message: 'Use a public http(s) URL.' }],
    });
  }
  if (target.hostIsIp) {
    const ipClass = classifyIp(target.host);
    if (ipClass !== 'public') throw new AppError('blocked_url');
  }
}

function cleanTitle(value: string): string {
  const title = value.trim().slice(0, 200);
  return title === '' ? 'Untitled source' : title;
}

/**
 * Spec §17.6. Admins add knowledge, resync it and delete it; every write that changes the
 * source also enqueues the next job and notifies the workspace, in the same transaction, so a
 * source never exists without its job and an admin never sees a stale status.
 */
@Injectable()
export class SourcesService {
  constructor(
    private readonly ds: DataSource,
    private readonly sources: SourcesRepository,
    private readonly documents: DocumentsRepository,
    private readonly versions: VersionsRepository,
    private readonly freshness: FreshnessRepository,
    private readonly versioning: VersioningService,
    private readonly chunks: ChunksRepository,
    private readonly bots: BotsService,
    private readonly jobs: JobsService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(workspaceId: WorkspaceId, botId: string): Promise<KnowledgeSourceEntity[]> {
    await this.bot(workspaceId, botId);
    return this.sources.listForBot(workspaceId, botId);
  }

  async create(
    workspaceId: WorkspaceId,
    botId: string,
    input: CreateSourceRequest,
    actor: UserId,
    manager?: EntityManager,
  ): Promise<KnowledgeSourceEntity> {
    await this.bot(workspaceId, botId);
    const parsed = createSourceSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;

    if (
      body.type === 'text' &&
      body.recrawlInterval !== null &&
      body.recrawlInterval !== undefined
    ) {
      throw new AppError('validation_failed', {
        details: [
          { path: 'recrawlInterval', message: 'Only URL and sitemap sources can recrawl.' },
        ],
      });
    }

    if (body.type === 'text') {
      if (Buffer.byteLength(body.body, 'utf8') > TEXT_SOURCE_MAX_BYTES) {
        throw new AppError('validation_failed', {
          details: [{ path: 'body', message: 'Text sources are limited to 200 KB.' }],
        });
      }
      return this.insertAndIngest(
        workspaceId,
        botId,
        actor,
        {
          type: 'text',
          title: body.title,
          sourceUrl: null,
          fileKey: null,
          options: { body: body.body },
          recrawlInterval: null,
        },
        manager,
      );
    }

    assertFetchable(body.url);
    if (body.type === 'url') {
      return this.insertAndIngest(workspaceId, botId, actor, {
        type: 'url',
        title: cleanTitle(body.title ?? new URL(body.url).hostname),
        sourceUrl: body.url,
        fileKey: null,
        options: {},
        recrawlInterval: body.recrawlInterval ?? null,
      });
    }

    return this.insertAndIngest(workspaceId, botId, actor, {
      type: 'sitemap',
      title: cleanTitle(new URL(body.url).hostname),
      sourceUrl: body.url,
      fileKey: null,
      options: {
        includePatterns: body.includePatterns ?? [],
        excludePatterns: body.excludePatterns ?? [],
        maxPages: body.maxPages ?? this.maxPages(),
      },
      recrawlInterval: body.recrawlInterval ?? null,
    });
  }

  /**
   * Validates the blob by its magic bytes before writing it anywhere (spec §12.1). The blob is
   * deleted again if the transaction that records it fails, so a rejected upload leaves nothing
   * behind.
   */
  async upload(
    workspaceId: WorkspaceId,
    botId: string,
    file: UploadedFile | undefined,
    providedTitle: string | undefined,
    actor: UserId,
  ): Promise<KnowledgeSourceEntity> {
    await this.bot(workspaceId, botId);
    if (file === undefined) {
      throw new AppError('validation_failed', {
        details: [{ path: 'file', message: 'Attach a file to upload.' }],
      });
    }
    const maxBytes = this.config.maxUploadMb * 1024 * 1024;
    if (file.buffer.length > maxBytes) throw new AppError('payload_too_large');

    const detected = detectFileType(file.buffer, file.filename);
    if (detected === null) throw new AppError('unsupported_file_type');

    const key = newStorageKey(workspaceId);
    const stored = await this.storage.put(key, file.buffer);
    try {
      return await this.ds.transaction(async (manager) => {
        const fileId = await this.sources.insertFile(manager, {
          workspaceId,
          storageKey: key,
          filename: file.filename.slice(0, 255),
          mimeType: MIME_BY_TYPE[detected],
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        });
        return this.insertAndIngest(
          workspaceId,
          botId,
          actor,
          {
            type: 'file',
            title: cleanTitle(providedTitle ?? file.filename),
            sourceUrl: null,
            fileKey: key,
            options: { fileId, detectedType: detected },
            recrawlInterval: null,
          },
          manager,
        );
      });
    } catch (error) {
      await this.storage.delete(key);
      throw error;
    }
  }

  async get(
    workspaceId: WorkspaceId,
    botId: string,
    sourceId: SourceId,
  ): Promise<KnowledgeSourceEntity> {
    const source = await this.sources.findForBot(workspaceId, botId, sourceId);
    if (source === null) throw new AppError('not_found');
    return source;
  }

  /** The viewer's source page: the source plus one cursor page of its documents. */
  async details(
    workspaceId: WorkspaceId,
    botId: string,
    sourceId: SourceId,
    cursor: string | null,
  ): Promise<{
    source: KnowledgeSourceEntity;
    documents: Awaited<ReturnType<DocumentsRepository['listSummariesForSource']>>['data'];
    nextCursor: string | null;
  }> {
    const source = await this.get(workspaceId, botId, sourceId);
    const page = await this.documents.listSummariesForSource(workspaceId, sourceId, {
      limit: 50,
      cursor: cursor === null ? null : decodeCursor(cursor),
    });
    return { source, documents: page.data, nextCursor: page.nextCursor };
  }

  /**
   * The document viewer: current version and its ordered chunks (spec §17.6). A document of
   * another bot is not found, even inside the same workspace.
   */
  async document(
    workspaceId: WorkspaceId,
    botId: string,
    documentId: string,
  ): Promise<{
    document: NonNullable<Awaited<ReturnType<DocumentsRepository['findForBot']>>>;
    currentVersion: Awaited<ReturnType<VersionsRepository['findCurrent']>>;
    chunks: Awaited<ReturnType<ChunksRepository['listForVersion']>>;
  }> {
    const document = await this.documents.findForBot(workspaceId, botId, documentId);
    if (document === null) throw new AppError('not_found');
    const currentVersion = await this.versions.findCurrent(workspaceId, documentId);
    const chunks =
      currentVersion === null
        ? []
        : await this.chunks.listForVersion(workspaceId, currentVersion.id);
    return { document, currentVersion, chunks };
  }

  async versionHistory(
    workspaceId: WorkspaceId,
    botId: string,
    documentId: string,
  ): Promise<DocumentVersionDto[]> {
    if ((await this.documents.findForBot(workspaceId, botId, documentId)) === null)
      throw new AppError('not_found');
    const rows = await this.versions.listForDocument(workspaceId, documentId);
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      contentHash: row.contentHash,
      editedBy: row.editedBy,
      isCurrent: row.isCurrent,
    }));
  }

  async versionDiff(
    workspaceId: WorkspaceId,
    botId: string,
    documentId: string,
    fromId: string,
    toId: string,
  ): Promise<VersionDiffDto> {
    if ((await this.documents.findForBot(workspaceId, botId, documentId)) === null)
      throw new AppError('not_found');
    const pair = await this.versions.findPairForDocument(workspaceId, documentId, fromId, toId);
    if (pair === null) throw new AppError('not_found');
    return diffVersions(pair.from.content, pair.to.content);
  }

  async staleDocuments(
    workspaceId: WorkspaceId,
    query: unknown,
  ): Promise<{
    data: FreshnessItemDto[];
    nextCursor: string | null;
  }> {
    const parsed = freshnessQuerySchema.safeParse(query);
    if (!parsed.success) throw validationError(parsed.error);
    const input: FreshnessQuery = parsed.data;
    const page = await this.freshness.listStaleDocuments({
      workspaceId,
      ...(input.botId === undefined ? {} : { botId: input.botId }),
      days: input.days,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: 50,
    });
    const data = page.data.map((row) => ({
      documentId: row.documentId,
      sourceId: row.sourceId,
      botId: row.botId,
      title: row.title,
      url: row.url,
      status: row.status as FreshnessItemDto['status'],
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastChangedAt: row.lastChangedAt?.toISOString() ?? null,
      unreachableSince: row.unreachableSince?.toISOString() ?? null,
    }));
    return { data, nextCursor: page.hasMore ? (data.at(-1)?.documentId ?? null) : null };
  }

  async editDocument(
    workspaceId: WorkspaceId,
    botId: string,
    documentId: string,
    input: ManualDocumentContentRequest,
    actor: UserId,
  ): Promise<{ changed: boolean; versionId: string | null }> {
    const parsed = manualDocumentContentSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (Buffer.byteLength(parsed.data.content, 'utf8') > TEXT_SOURCE_MAX_BYTES) {
      throw new AppError('validation_failed', {
        details: [{ path: 'content', message: 'Document content is limited to 200 KB.' }],
      });
    }
    const document = await this.documents.findForBot(workspaceId, botId, documentId);
    if (document === null) throw new AppError('not_found');
    const source = await this.sources.findById(workspaceId, document.sourceId);
    if (source?.botId !== botId) throw new AppError('not_found');
    if (source.type !== 'text' && source.type !== 'file') {
      throw new AppError('conflict', {
        message: 'Crawled URL and sitemap pages are updated by their next crawl.',
      });
    }
    if (
      source.status === 'deleting' ||
      source.status === 'pending' ||
      source.status === 'processing'
    ) {
      throw new AppError('conflict', {
        message: 'Wait for the source sync to finish before editing this document.',
      });
    }
    const bot = await this.bot(workspaceId, botId);
    const normalized = normalizeMarkdown(parsed.data.content);
    const current = await this.versions.findCurrent(workspaceId, documentId);
    if (current !== null && current.contentHash === contentHash(normalized)) {
      return { changed: false, versionId: null };
    }
    return this.ds.transaction(async (manager) => {
      const lockedSource = await this.sources.findByIdForUpdate(manager, workspaceId, source.id);
      if (lockedSource === null) throw new AppError('not_found');
      if (
        lockedSource.status === 'deleting' ||
        lockedSource.status === 'pending' ||
        lockedSource.status === 'processing'
      ) {
        throw new AppError('conflict', {
          message: 'Wait for the source sync to finish before editing this document.',
        });
      }
      const recorded = await this.versioning.recordContent(
        workspaceId,
        documentId,
        { title: document.title, markdown: normalized, warnings: [] },
        actor,
        manager,
      );
      if (!recorded.changed) return { changed: false, versionId: null };
      await this.sources.setManualContent(manager, workspaceId, lockedSource, normalized);
      await this.jobs.enqueue(
        EMBED_CHUNKS_JOB,
        {
          workspaceId,
          botId,
          documentVersionId: recorded.versionId,
          embeddingModel: bot.embeddingModel,
        },
        { manager, singletonKey: `manual-edit:${documentId}:${recorded.versionId}` },
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'knowledge.document_edited',
          targetType: 'document',
          targetId: documentId,
          metadata: { sourceId: source.id, versionId: recorded.versionId },
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'source.updated',
        sourceId: source.id,
        botId,
        status: 'processing',
      });
      return { changed: true, versionId: recorded.versionId };
    });
  }

  /** Runs one ingestion pass per source: a second resync while one is queued is ignored. */
  async resync(
    workspaceId: WorkspaceId,
    botId: string,
    sourceId: SourceId,
    actor: UserId | null,
  ): Promise<KnowledgeSourceEntity> {
    const source = await this.get(workspaceId, botId, sourceId);
    if (source.status === 'deleting') throw new AppError('conflict');

    return this.ds.transaction(async (manager) => {
      await this.sources.setStatus(manager, workspaceId, sourceId, 'pending');
      await this.sources.resetProgress(manager, workspaceId, sourceId);
      // A resync while one is already queued would index the source twice; the guard and the
      // job's own `singletonKey` both say the same thing, the guard because pg-boss only
      // dedupes within one send call.
      if (!(await this.sources.hasActiveJob(manager, INGEST_SOURCE_JOB.name, sourceId))) {
        await this.jobs.enqueue(
          INGEST_SOURCE_JOB,
          { workspaceId, sourceId },
          { manager, singletonKey: sourceId },
        );
      }
      await notifyWorkspace(manager, workspaceId, {
        type: 'source.updated',
        sourceId,
        botId,
        status: 'pending',
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'knowledge.source_resynced',
          targetType: 'source',
          targetId: sourceId,
          metadata: { type: source.type },
        },
        manager,
      );
      return this.sources.getById(workspaceId, sourceId, 'not_found', manager);
    });
  }

  async update(
    workspaceId: WorkspaceId,
    botId: string,
    sourceId: SourceId,
    input: UpdateSourceRequest,
    actor: UserId,
  ): Promise<KnowledgeSourceEntity> {
    const parsed = updateSourceSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const source = await this.get(workspaceId, botId, sourceId);
    if (source.status === 'deleting') throw new AppError('conflict');
    if (
      parsed.data.recrawlInterval !== null &&
      source.type !== 'url' &&
      source.type !== 'sitemap'
    ) {
      throw new AppError('validation_failed', {
        details: [
          { path: 'recrawlInterval', message: 'Only URL and sitemap sources can recrawl.' },
        ],
      });
    }

    return this.ds.transaction(async (manager) => {
      await this.sources.updateById(
        workspaceId,
        sourceId,
        { recrawlInterval: parsed.data.recrawlInterval },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'source.updated',
        sourceId,
        botId,
        status: source.status,
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'knowledge.source_updated',
          targetType: 'source',
          targetId: sourceId,
          metadata: { recrawlInterval: parsed.data.recrawlInterval, type: source.type },
        },
        manager,
      );
      return this.sources.getById(workspaceId, sourceId, 'not_found', manager);
    });
  }

  /** Called by the recrawl worker; null actor records a system initiated audit entry. */
  async resyncDueSource(workspaceId: WorkspaceId, sourceId: SourceId): Promise<void> {
    const source = await this.sources.findById(workspaceId, sourceId);
    if (
      source?.status !== 'ready' ||
      source.recrawlInterval === null ||
      (source.type !== 'url' && source.type !== 'sitemap')
    ) {
      return;
    }
    await this.ds.transaction(async (manager) => {
      const botId = await this.sources.startDueRecrawl(manager, workspaceId, sourceId);
      if (botId === null) return;
      await this.sources.resetProgress(manager, workspaceId, sourceId);
      if (!(await this.sources.hasActiveJob(manager, INGEST_SOURCE_JOB.name, sourceId))) {
        await this.jobs.enqueue(
          INGEST_SOURCE_JOB,
          { workspaceId, sourceId },
          { manager, singletonKey: sourceId },
        );
      }
      await notifyWorkspace(manager, workspaceId, {
        type: 'source.updated',
        sourceId,
        botId,
        status: 'pending',
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: null,
          action: 'knowledge.source_resynced',
          targetType: 'source',
          targetId: sourceId,
          metadata: { type: source.type, trigger: 'schedule' },
        },
        manager,
      );
    });
  }

  /** 202: the row is marked `deleting` now, and the job removes it (spec §12.8). */
  async delete(
    workspaceId: WorkspaceId,
    botId: string,
    sourceId: SourceId,
    actor: UserId,
  ): Promise<void> {
    const source = await this.get(workspaceId, botId, sourceId);
    if (source.status === 'deleting') return;

    await this.ds.transaction(async (manager) => {
      await this.sources.setStatus(manager, workspaceId, sourceId, 'deleting');
      await this.jobs.enqueue(
        DELETE_SOURCE_JOB,
        { workspaceId, sourceId },
        { manager, singletonKey: `delete:${sourceId}` },
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'source.updated',
        sourceId,
        botId,
        status: 'deleting',
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'knowledge.source_deleted',
          targetType: 'source',
          targetId: sourceId,
          metadata: { type: source.type, title: source.title },
        },
        manager,
      );
    });
  }

  private maxPages(): number {
    return Math.min(CRAWL_MAX_PAGES_DEFAULT, this.config.crawl.maxPages);
  }

  private async bot(workspaceId: WorkspaceId, botId: string): Promise<BotEntity> {
    return this.bots.get(workspaceId, botId);
  }

  private async insertAndIngest(
    workspaceId: WorkspaceId,
    botId: string,
    actor: UserId,
    source: {
      type: KnowledgeSourceEntity['type'];
      title: string;
      sourceUrl: string | null;
      fileKey: string | null;
      options: Record<string, unknown>;
      recrawlInterval: RecrawlInterval | null;
    },
    existingManager?: EntityManager,
  ): Promise<KnowledgeSourceEntity> {
    const run = async (manager: EntityManager): Promise<KnowledgeSourceEntity> => {
      const created = await this.sources.insert(
        workspaceId,
        {
          botId,
          type: source.type,
          title: source.title,
          sourceUrl: source.sourceUrl,
          fileKey: source.fileKey,
          recrawlInterval: source.recrawlInterval,
          status: 'pending',
          options: source.options,
        },
        manager,
      );
      await this.jobs.enqueue(
        INGEST_SOURCE_JOB,
        { workspaceId, sourceId: created.id },
        { manager, singletonKey: created.id },
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'source.updated',
        sourceId: created.id,
        botId,
        status: 'pending',
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'knowledge.source_added',
          targetType: 'source',
          targetId: created.id,
          metadata: { type: created.type, title: created.title },
        },
        manager,
      );
      return created;
    };

    if (existingManager !== undefined) return run(existingManager);
    return this.ds.transaction(run);
  }
}
