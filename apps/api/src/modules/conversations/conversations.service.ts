// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import type {
  ConversationCounts,
  ConversationDetail,
  ConversationInboxQuery,
  ConversationListItem,
  Page,
} from '@app/shared';

import { AppError } from '../../common/errors';
import type { UserId, WorkspaceId } from '../../db/ids';
import {
  toAdminMessage,
  toConversationDetail,
  toConversationListItem,
} from './conversations.mapper';
import { InboxQuery } from './inbox.repository';
import { MessagesRepository } from './messages.repository';

/** The agent inbox read paths (spec §17.7). All queries are workspace-scoped. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly inbox: InboxQuery,
    private readonly messages: MessagesRepository,
  ) {}

  async list(
    workspaceId: WorkspaceId,
    filters: ConversationInboxQuery,
    viewerUserId: UserId,
  ): Promise<Page<ConversationListItem>> {
    const page = await this.inbox.search(workspaceId, filters, viewerUserId);
    return {
      data: page.data.map(toConversationListItem),
      nextCursor: page.nextCursor,
    };
  }

  async counts(workspaceId: WorkspaceId, viewerUserId: UserId): Promise<ConversationCounts> {
    return this.inbox.counts(workspaceId, viewerUserId);
  }

  async detail(workspaceId: WorkspaceId, conversationId: string): Promise<ConversationDetail> {
    const row = await this.inbox.detail(workspaceId, conversationId);
    if (row === null) throw new AppError('not_found');

    const messages = await this.messages.listForConversation(workspaceId, conversationId);
    const contactHistory = await this.inbox.contactHistory(
      workspaceId,
      row.contact_id,
      conversationId,
    );
    const aiMessageIds = messages
      .filter((message) => message.role === 'ai')
      .map((message) => message.id);
    const traceIds = await this.inbox.traceIdsByMessageIds(workspaceId, aiMessageIds);
    const authorIds = [
      ...new Set(
        messages.flatMap((message) =>
          message.authorUserId === null ? [] : [message.authorUserId],
        ),
      ),
    ];
    const authors = await this.inbox.authorsByIds(authorIds);

    return toConversationDetail(
      row,
      messages.map((message) =>
        toAdminMessage(
          message,
          traceIds.get(message.id) ?? null,
          message.authorUserId === null ? null : (authors.get(message.authorUserId) ?? null),
        ),
      ),
      contactHistory,
    );
  }
}
