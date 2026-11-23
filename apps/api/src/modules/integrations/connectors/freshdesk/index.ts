// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional } from '@nestjs/common';

import type { IntegrationEventType } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import type { ConnectorHandleResult, IntegrationConnection, IntegrationEvent } from '../connector';
import { contactIdentity, contactResult, readProviderResponse } from '../provider-contact';
import {
  CONNECTOR_FETCH,
  ConnectorRejectedError,
  RestCrmConnector,
  type ConnectorFetch,
} from '../rest-crm-connector';

@Injectable()
export class FreshdeskConnector extends RestCrmConnector {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(CONNECTOR_FETCH) fetcher?: ConnectorFetch,
  ) {
    super(
      {
        provider: 'freshdesk',
        capabilities: ['contacts'],
        baseUrl: 'https://example.freshdesk.com',
        healthPath: '/api/v2/agents/me',
        contactPath: '/api/v2/contacts',
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
    if (
      connection.credentials.authMode === 'api_key' ||
      connection.credentials.authMode === undefined
    ) {
      return {
        authorization: `Basic ${Buffer.from(`${connection.credentials.accessToken}:X`).toString('base64')}`,
      };
    }
    return { authorization: `Bearer ${connection.credentials.accessToken}` };
  }

  override async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    const identity = contactIdentity(event);
    if (identity === null || identity.email === '') return { skippedReason: 'missing_email' };
    if (identity.name === '') return { skippedReason: 'missing_name' };
    const params = new URLSearchParams({ term: identity.email });
    const searchResponse = await this.request(
      connection,
      `/api/v2/contacts/autocomplete?${params.toString()}`,
      'GET',
    );
    const search = await readProviderResponse(searchResponse, 'freshdesk');
    const existing = freshdeskContact(search, identity.email);
    const response = await this.request(
      connection,
      existing === undefined
        ? '/api/v2/contacts'
        : `/api/v2/contacts/${encodeURIComponent(existing.id)}`,
      existing === undefined ? 'POST' : 'PUT',
      { name: identity.name, email: identity.email },
      event.id,
    );
    const result = await readProviderResponse(response, 'freshdesk');
    return contactResult(event, response, getId(result) ?? existing?.id, 'contact');
  }
}

function getId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('id' in value)) return undefined;
  return typeof value.id === 'string' || typeof value.id === 'number'
    ? String(value.id)
    : undefined;
}

function freshdeskContact(value: unknown, email: string): { id: string } | undefined {
  const rows = Array.isArray(value)
    ? value
    : typeof value === 'object' &&
        value !== null &&
        'contacts' in value &&
        Array.isArray(value.contacts)
      ? value.contacts
      : [];
  let matchingId: string | undefined;
  for (const row of rows as unknown[]) {
    if (typeof row !== 'object' || row === null || !('email' in row) || !('id' in row)) continue;
    if (typeof row.email !== 'string' || row.email.toLowerCase() !== email.toLowerCase()) continue;
    const id = row.id;
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    if (matchingId !== undefined) {
      throw new ConnectorRejectedError('freshdesk returned multiple contacts for one email', 409);
    }
    matchingId = String(id);
  }
  return matchingId === undefined ? undefined : { id: matchingId };
}
