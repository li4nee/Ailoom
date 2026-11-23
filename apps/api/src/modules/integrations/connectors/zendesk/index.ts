// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional } from '@nestjs/common';

import type { IntegrationEventType } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import type { ConnectorHandleResult, IntegrationConnection, IntegrationEvent } from '../connector';
import { contactIdentity, contactResult, readProviderResponse } from '../provider-contact';
import { CONNECTOR_FETCH, RestCrmConnector, type ConnectorFetch } from '../rest-crm-connector';

@Injectable()
export class ZendeskConnector extends RestCrmConnector {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(CONNECTOR_FETCH) fetcher?: ConnectorFetch,
  ) {
    super(
      {
        provider: 'zendesk',
        capabilities: ['contacts'],
        baseUrl: 'https://example.zendesk.com',
        healthPath: '/api/v2/users/me.json',
        contactPath: '/api/v2/users/create_or_update.json',
        contactObjectType: 'user',
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
    const authorization =
      connection.credentials.authMode === 'api_key'
        ? `Basic ${Buffer.from(`${connection.credentials.authUser ?? ''}/token:${connection.credentials.accessToken}`).toString('base64')}`
        : `Bearer ${connection.credentials.accessToken}`;
    return { authorization };
  }

  override async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    const identity = contactIdentity(event);
    if (identity === null || (identity.email === '' && identity.externalId === null)) {
      return { skippedReason: 'missing_identity' };
    }
    if (identity.name === '') return { skippedReason: 'missing_name' };
    const user = {
      name: identity.name,
      ...(identity.email === '' ? {} : { email: identity.email }),
      ...(identity.externalId === null ? {} : { external_id: identity.externalId }),
    };
    const response = await this.request(
      connection,
      '/api/v2/users/create_or_update.json',
      'POST',
      { user },
      event.id,
    );
    const result = await readProviderResponse(response, 'zendesk');
    return contactResult(event, response, getId(result), 'user');
  }
}

function getId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('user' in value)) return undefined;
  const user = value.user;
  if (typeof user !== 'object' || user === null || !('id' in user)) return undefined;
  return typeof user.id === 'string' || typeof user.id === 'number' ? String(user.id) : undefined;
}
