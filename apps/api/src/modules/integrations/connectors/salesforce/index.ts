// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class SalesforceConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'salesforce',
        capabilities: ['contacts', 'companies', 'leads', 'cases', 'timeline'],
        baseUrl: 'https://instance.salesforce.com',
        healthPath: '/services/data/v60.0/limits',
        contactPath: '/services/data/v60.0/sobjects/Contact',
        contactObjectType: 'contact',
        handoffPath: '/services/data/v60.0/sobjects/Case',
        handoffObjectType: 'case',
        timelinePath: '/services/data/v60.0/sobjects/Task',
      },
      config,
    );
  }
}
