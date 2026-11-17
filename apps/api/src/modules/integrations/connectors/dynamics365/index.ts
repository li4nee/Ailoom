// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class Dynamics365Connector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'dynamics365',
        capabilities: ['contacts', 'companies', 'leads', 'cases', 'timeline'],
        baseUrl: 'https://org.crm.dynamics.com',
        healthPath: '/api/data/v9.2/WhoAmI',
        contactPath: '/api/data/v9.2/contacts',
        contactObjectType: 'contact',
        handoffPath: '/api/data/v9.2/incidents',
        handoffObjectType: 'case',
        timelinePath: '/api/data/v9.2/tasks',
      },
      config,
    );
  }
}
