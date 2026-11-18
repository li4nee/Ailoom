// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class HubSpotConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'hubspot',
        capabilities: ['contacts', 'companies', 'tickets', 'timeline'],
        baseUrl: 'https://api.hubapi.com',
        healthPath: '/crm/v3/objects/contacts?limit=1',
        contactPath: '/crm/v3/objects/contacts',
        contactObjectType: 'contact',
        handoffPath: '/crm/v3/objects/tickets',
        handoffObjectType: 'ticket',
        timelinePath: '/crm/v3/objects/notes',
      },
      config,
    );
  }
}
