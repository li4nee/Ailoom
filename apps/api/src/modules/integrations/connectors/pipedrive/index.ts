// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import { RestCrmConnector } from '../rest-crm-connector';

@Injectable()
export class PipedriveConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'pipedrive',
        capabilities: ['contacts', 'companies', 'deals', 'timeline'],
        baseUrl: 'https://api.pipedrive.com',
        healthPath: '/v1/users/me',
        contactPath: '/v1/persons',
        contactObjectType: 'person',
        handoffPath: '/v1/activities',
        handoffObjectType: 'activity',
        timelinePath: '/v1/notes',
      },
      config,
    );
  }
}
