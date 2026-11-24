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
import type { KnowledgeSourceEntity } from './entities/knowledge-source.entity';
import { DELETE_SOURCE_JOB, INGEST_SOURCE_JOB } from './knowledge.jobs';
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

  /** Runs one ingestion pass per source: a second resync while one is queued is ignored. */
  async resync(
    workspaceId: WorkspaceId,
    botId: string,
    sourceId: SourceId,
    actor: UserId,
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
