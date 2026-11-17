// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class ZendeskConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'zendesk',
        capabilities: ['contacts', 'companies', 'tickets', 'transcripts'],
        baseUrl: 'https://example.zendesk.com',
        healthPath: '/api/v2/users/me.json',
        contactPath: '/api/v2/users.json',
        contactObjectType: 'user',
        handoffPath: '/api/v2/tickets.json',
        handoffObjectType: 'ticket',
        timelinePath: '/api/v2/tickets.json',
      },
      config,
    );
  }
}
