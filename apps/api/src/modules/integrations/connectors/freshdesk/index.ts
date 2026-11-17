// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class FreshdeskConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'freshdesk',
        capabilities: ['contacts', 'companies', 'tickets', 'transcripts'],
        baseUrl: 'https://example.freshdesk.com',
        healthPath: '/api/v2/agents/me',
        contactPath: '/api/v2/contacts',
        contactObjectType: 'contact',
        handoffPath: '/api/v2/tickets',
        handoffObjectType: 'ticket',
        timelinePath: '/api/v2/tickets',
      },
      config,
    );
  }
}
