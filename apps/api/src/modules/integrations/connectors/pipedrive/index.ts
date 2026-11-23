// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional } from '@nestjs/common';

import type { IntegrationEventType } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import type { ConnectorHandleResult, IntegrationConnection, IntegrationEvent } from '../connector';
import { mappedCrmContext } from '../crm-context';
import { contactIdentity, contactResult, readProviderResponse } from '../provider-contact';
import {
  CONNECTOR_FETCH,
  ConnectorRejectedError,
  RestCrmConnector,
  type ConnectorHttpMethod,
  type ConnectorFetch,
} from '../rest-crm-connector';

@Injectable()
export class PipedriveConnector extends RestCrmConnector {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(CONNECTOR_FETCH) fetcher?: ConnectorFetch,
  ) {
    super(
      {
        provider: 'pipedrive',
        capabilities: ['contacts'],
        baseUrl: 'https://api.pipedrive.com',
        healthPath: '/api/v1/users/me',
        contactPath: '/api/v2/persons',
        contactObjectType: 'person',
        handoffPath: null,
        handoffObjectType: null,
        timelinePath: null,
      },
      config,
      fetcher,
    );
  }

  override supportsEvent(type: IntegrationEventType): boolean {
    return type === 'contact.created' || type === 'contact.updated';
  }

  protected override requestHeaders(connection: IntegrationConnection): Record<string, string> {
    return connection.credentials.authMode === 'api_key' ? {} : super.requestHeaders(connection);
  }

  protected override request(
    connection: IntegrationConnection,
    path: string,
    method: ConnectorHttpMethod,
    body?: unknown,
    idempotencyKey?: string,
    additionalHeaders: Record<string, string> = {},
  ): Promise<Response> {
    if (connection.credentials.authMode !== 'api_key') {
      return super.request(connection, path, method, body, idempotencyKey, additionalHeaders);
    }
    const url = new URL(path, connection.credentials.baseUrl ?? 'https://api.pipedrive.com');
    url.searchParams.set('api_token', connection.credentials.accessToken);
    return super.request(
      connection,
      `${url.pathname}${url.search}`,
      method,
      body,
      idempotencyKey,
      additionalHeaders,
    );
  }

  override async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    const identity = contactIdentity(event);
    if (identity === null || identity.email === '') return { skippedReason: 'missing_email' };
    if (identity.name === '') return { skippedReason: 'missing_name' };
    const searchParams = new URLSearchParams({
      term: identity.email,
      fields: 'email',
      exact_match: 'true',
    });
    const searchResponse = await this.request(
      connection,
      `/api/v2/persons/search?${searchParams.toString()}`,
      'GET',
    );
    const search = await readProviderResponse(searchResponse, 'pipedrive');
    const existingId = pipedriveSearchId(search);
    const body = {
      name: identity.name,
      emails: [{ value: identity.email, primary: true }],
      ...mappedCrmContext(event, connection.settings.crmContextFields),
    };
    const response = await this.request(
      connection,
      existingId === undefined
        ? '/api/v2/persons'
        : `/api/v2/persons/${encodeURIComponent(existingId)}`,
      existingId === undefined ? 'POST' : 'PUT',
      body,
      event.id,
    );
    const result = await readProviderResponse(response, 'pipedrive');
    const externalObjectId = pipedriveResponseId(result) ?? existingId;
    return contactResult(event, response, externalObjectId, 'person');
  }
}

function recordId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('id' in value)) return undefined;
  return typeof value.id === 'string' || typeof value.id === 'number'
    ? String(value.id)
    : undefined;
}

function pipedriveSearchId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('data' in value)) return undefined;
  const data = value.data;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('items' in data) ||
    !Array.isArray(data.items)
  ) {
    return undefined;
  }
  if (data.items.length > 1) {
    throw new ConnectorRejectedError('pipedrive returned multiple persons for one email', 409);
  }
  const first: unknown = data.items[0];
  if (typeof first !== 'object' || first === null || !('item' in first)) return undefined;
  return recordId(first.item);
}

function pipedriveResponseId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('data' in value)) return undefined;
  return recordId(value.data);
}
