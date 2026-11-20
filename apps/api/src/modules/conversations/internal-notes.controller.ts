// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import {
  internalNoteDeleteSchema,
  internalNoteUpdateSchema,
  internalNoteWriteSchema,
  type InternalNote,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { InternalNotesService } from './internal-notes.service';

class InternalNoteWriteDto extends createZodDto(internalNoteWriteSchema) {}
class InternalNoteUpdateDto extends createZodDto(internalNoteUpdateSchema) {}
class InternalNoteDeleteDto extends createZodDto(internalNoteDeleteSchema) {}

@RequireRole('agent')
@SessionOnly()
@Controller('v1/workspaces/:workspaceId/conversations/:conversationId/internal-notes')
export class InternalNotesController {
  constructor(private readonly notes: InternalNotesService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
  ): Promise<InternalNote[]> {
    return this.notes.list(this.workspaceOf(principal), conversationId);
  }

  @Post()
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Body() body: InternalNoteWriteDto,
  ): Promise<InternalNote> {
    return this.notes.create(this.workspaceOf(principal), conversationId, principal.userId, body);
  }

  @Patch(':noteId')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Param('noteId') noteId: string,
    @Body() body: InternalNoteUpdateDto,
  ): Promise<InternalNote> {
    return this.notes.update(
      this.workspaceOf(principal),
      conversationId,
      noteId,
      principal.userId,
      body,
    );
  }

  @Delete(':noteId')
  delete(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Param('noteId') noteId: string,
    @Body() body: InternalNoteDeleteDto,
  ): Promise<InternalNote> {
    return this.notes.delete(
      this.workspaceOf(principal),
      conversationId,
      noteId,
      principal.userId,
      body.expectedVersion,
    );
  }

  private workspaceOf(principal: Principal) {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return workspaceId;
  }
}
