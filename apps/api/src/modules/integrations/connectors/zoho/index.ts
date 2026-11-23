// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional } from '@nestjs/common';

import type { IntegrationEventType } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import type { ConnectorHandleResult, IntegrationConnection, IntegrationEvent } from '../connector';
import {
  contactIdentity,
  contactResult,
  nameParts,
  readProviderResponse,
} from '../provider-contact';
import { CONNECTOR_FETCH, RestCrmConnector, type ConnectorFetch } from '../rest-crm-connector';

@Injectable()
export class ZohoConnector extends RestCrmConnector {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(CONNECTOR_FETCH) fetcher?: ConnectorFetch,
  ) {
    super(
      {
        provider: 'zoho',
        capabilities: ['contacts'],
        baseUrl: 'https://www.zohoapis.com',
        healthPath: '/crm/v8/users?type=CurrentUser',
        contactPath: '/crm/v8/Contacts/upsert',
        contactObjectType: 'contact',
        handoffPath: null,
        handoffObjectType: null,
        timelinePath: null,
        requiresBaseUrl: true,
      },
      config,
      fetcher,
    );
  }

  override supportsEvent(type: IntegrationEventType): boolean {
    return type === 'contact.created' || type === 'contact.updated';
  }

  protected override requestHeaders(connection: IntegrationConnection): Record<string, string> {
    return {
      authorization: `Zoho-oauthtoken ${connection.credentials.accessToken.replace(/^Zoho-oauthtoken\s+/iu, '')}`,
    };
  }

  override async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    const identity = contactIdentity(event);
    if (identity === null || identity.email === '') return { skippedReason: 'missing_email' };
    if (identity.name === '') return { skippedReason: 'missing_name' };
    const { firstName, lastName } = nameParts(identity.name);
    const response = await this.request(
      connection,
      '/crm/v8/Contacts/upsert',
      'POST',
      {
        data: [
          {
            Email: identity.email,
            Last_Name: lastName || firstName,
            ...(lastName === '' ? {} : { First_Name: firstName }),
          },
        ],
        duplicate_check_fields: ['Email'],
      },
      event.id,
    );
    const result = await readProviderResponse(response, 'zoho');
    const id =
      typeof result === 'object' &&
      result !== null &&
      'data' in result &&
      Array.isArray(result.data)
        ? nestedId(result.data[0])
        : undefined;
    return contactResult(event, response, id, 'contact');
  }
}

function nestedId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('details' in value)) return undefined;
  const details = value.details;
  return typeof details === 'object' &&
    details !== null &&
    'id' in details &&
    typeof details.id === 'string'
    ? details.id
    : undefined;
}
