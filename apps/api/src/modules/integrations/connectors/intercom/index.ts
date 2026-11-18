// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class IntercomConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'intercom',
        capabilities: ['contacts', 'companies', 'conversations', 'timeline', 'transcripts'],
        baseUrl: 'https://api.intercom.io',
        healthPath: '/me',
        contactPath: '/contacts',
        contactObjectType: 'contact',
        handoffPath: '/conversations',
        handoffObjectType: 'conversation',
        timelinePath: '/notes',
      },
      config,
    );
  }
}
