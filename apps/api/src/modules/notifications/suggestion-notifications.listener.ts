// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import {
  SUGGESTION_CREATED,
  SUGGESTION_REVIEWED,
  type SuggestionCreatedEvent,
  type SuggestionReviewedEvent,
} from '../domain-events';
import { NotificationsService } from './notifications.service';

@Injectable()
export class SuggestionNotificationsListener {
  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(SUGGESTION_CREATED)
  async created(event: SuggestionCreatedEvent): Promise<void> {
    await this.ds.transaction((manager) =>
      this.notifications.notify(manager, {
        type: 'suggestion_created',
        workspaceId: event.workspaceId,
        suggestionId: event.suggestionId,
        botId: event.botId,
        actorUserId: event.actorUserId,
      }),
    );
  }

  @OnEvent(SUGGESTION_REVIEWED)
  async reviewed(event: SuggestionReviewedEvent): Promise<void> {
    await this.ds.transaction((manager) =>
      this.notifications.notify(manager, {
        type: 'suggestion_reviewed',
        workspaceId: event.workspaceId,
        suggestionId: event.suggestionId,
        botId: event.botId,
        actorUserId: event.reviewerUserId,
        creatorUserId: event.creatorUserId,
        status: event.status,
      }),
    );
  }
}
