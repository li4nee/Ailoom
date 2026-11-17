// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class ZohoConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'zoho',
        capabilities: ['contacts', 'companies', 'leads', 'deals', 'timeline'],
        baseUrl: 'https://www.zohoapis.com',
        healthPath: '/crm/v6/users?type=CurrentUser',
        contactPath: '/crm/v6/Contacts/upsert',
        contactObjectType: 'contact',
        handoffPath: '/crm/v6/Tasks',
        handoffObjectType: 'task',
        timelinePath: '/crm/v6/Notes',
      },
      config,
    );
  }
}
