// SPDX-License-Identifier: AGPL-3.0-only
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-node/multer/index.js';

import type { CreateSourceRequest, DocumentViewDto, SourceDetailDto, SourceDto } from '@app/shared';

import { asBotId, asSourceId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { toDocumentViewDto, toSourceDetailDto, toSourceDto } from './knowledge.mapper';
import { SourcesService, type UploadedFile as UploadedFileBody } from './sources.service';

/** The subset of multer's file object this route reads. */
interface MultipartFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/**
 * Spec §17.6. Reading and writing knowledge is admin-only: a source changes what every visitor
 * is told. The upload is validated after multer has buffered it, so the magic bytes of the
 * whole file are checked before it is stored (spec §12.1).
 */
@Controller('v1/workspaces/:workspaceId/bots/:botId')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get('sources')
  @RequireRole('admin')
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
  ): Promise<SourceDto[]> {
    return (await this.sources.list(asWorkspaceId(workspaceId), asBotId(botId))).map(toSourceDto);
  }

  @Post('sources')
  @RequireRole('admin')
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: CreateSourceRequest,
  ): Promise<SourceDto> {
    return toSourceDto(
      await this.sources.create(asWorkspaceId(workspaceId), asBotId(botId), body, principal.userId),
    );
  }

  @Post('sources/upload')
  @RequireRole('admin')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @UploadedFile() file: MultipartFile | undefined,
    @Body() body: { title?: string } | undefined,
  ): Promise<SourceDto> {
    const uploaded: UploadedFileBody | undefined =
      file === undefined
        ? undefined
        : {
            buffer: file.buffer,
            filename: file.originalname,
            mimetype: file.mimetype,
          };
    return toSourceDto(
      await this.sources.upload(
        asWorkspaceId(workspaceId),
        asBotId(botId),
        uploaded,
        typeof body?.title === 'string' ? body.title : undefined,
        principal.userId,
      ),
    );
  }

  /** The source with one cursor page of its documents (viewer). */
  @Get('sources/:sourceId')
  @RequireRole('admin')
  async get(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('sourceId') sourceId: string,
    @Query('cursor') cursor: string | undefined,
  ): Promise<SourceDetailDto> {
    const detail = await this.sources.details(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      asSourceId(sourceId),
      cursor ?? null,
    );
    return toSourceDetailDto(detail.source, detail.documents, detail.nextCursor);
  }

  /** Current version and ordered chunks; never the embeddings. */
  @Get('documents/:documentId')
  @RequireRole('admin')
  async document(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('documentId') documentId: string,
  ): Promise<DocumentViewDto> {
    return toDocumentViewDto(
      await this.sources.document(asWorkspaceId(workspaceId), asBotId(botId), documentId),
    );
  }

  @Post('sources/:sourceId/resync')
  @RequireRole('admin')
  @HttpCode(HttpStatus.OK)
  async resync(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<SourceDto> {
    return toSourceDto(
      await this.sources.resync(
        asWorkspaceId(workspaceId),
        asBotId(botId),
        asSourceId(sourceId),
        principal.userId,
      ),
    );
  }

  /** 202: the source is marked `deleting` and the worker removes it (spec §12.8). */
  @Delete('sources/:sourceId')
  @RequireRole('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<void> {
    await this.sources.delete(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      asSourceId(sourceId),
      principal.userId,
    );
  }
}
