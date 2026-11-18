// SPDX-License-Identifier: AGPL-3.0-only
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { SavedReply } from '@app/shared';
import { savedReplyOrderSchema, savedReplyQuerySchema, savedReplyWriteSchema } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { SavedRepliesService } from './saved-replies.service';

class SavedReplyQueryDto extends createZodDto(savedReplyQuerySchema) {}
class SavedReplyWriteDto extends createZodDto(savedReplyWriteSchema) {}
class SavedReplyOrderDto extends createZodDto(savedReplyOrderSchema) {}

@SessionOnly()
@RequireRole('agent')
@Controller('v1/workspaces/:workspaceId/saved-replies')
export class SavedRepliesController {
  constructor(private readonly replies: SavedRepliesService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Query() query: SavedReplyQueryDto,
  ): Promise<SavedReply[]> {
    const includeArchived =
      principal.workspace?.role !== 'agent' && query.includeArchived === 'true';
    return this.replies.list(asWorkspaceId(workspaceId), {
      ...(query.q === undefined ? {} : { q: query.q }),
      includeArchived: includeArchived ? 'true' : 'false',
    });
  }

  @RequireRole('admin')
  @Post()
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: SavedReplyWriteDto,
  ): Promise<SavedReply> {
    return this.replies.create(asWorkspaceId(workspaceId), principal.userId, body);
  }

  @RequireRole('admin')
  @Patch('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: SavedReplyOrderDto,
  ): Promise<void> {
    await this.replies.reorder(asWorkspaceId(workspaceId), principal.userId, body);
  }

  @RequireRole('admin')
  @Patch(':replyId')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('replyId') replyId: string,
    @Body() body: SavedReplyWriteDto,
  ): Promise<SavedReply> {
    return this.replies.update(asWorkspaceId(workspaceId), principal.userId, replyId, body);
  }

  @RequireRole('admin')
  @Delete(':replyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('replyId') replyId: string,
  ): Promise<void> {
    await this.replies.archive(asWorkspaceId(workspaceId), principal.userId, replyId);
  }
}
