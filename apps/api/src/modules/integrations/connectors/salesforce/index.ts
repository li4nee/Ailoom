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
import {
  CONNECTOR_FETCH,
  ConnectorRejectedError,
  RestCrmConnector,
  type ConnectorFetch,
} from '../rest-crm-connector';

@Injectable()
export class SalesforceConnector extends RestCrmConnector {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(CONNECTOR_FETCH) fetcher?: ConnectorFetch,
  ) {
    super(
      {
        provider: 'salesforce',
        capabilities: ['contacts'],
        baseUrl: 'https://instance.salesforce.com',
        healthPath: '/services/data/v68.0/limits',
        contactPath: '/services/data/v68.0/sobjects/Contact',
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

  override async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    const identity = contactIdentity(event);
    if (identity === null || identity.email === '') return { skippedReason: 'missing_email' };
    if (identity.name === '') return { skippedReason: 'missing_name' };
    const { firstName, lastName } = nameParts(identity.name);
    const fields = {
      Email: identity.email,
      ...(lastName === '' ? {} : { FirstName: firstName }),
      LastName: lastName || firstName,
    };
    const escapedEmail = identity.email.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    const query = `SELECT Id FROM Contact WHERE Email = '${escapedEmail}' LIMIT 2`;
    const searchPath = `/services/data/v68.0/query?q=${encodeURIComponent(query)}`;
    const searchResponse = await this.request(connection, searchPath, 'GET');
    const search = await readProviderResponse(searchResponse, 'salesforce');
    const records =
      typeof search === 'object' &&
      search !== null &&
      'records' in search &&
      Array.isArray(search.records)
        ? (search.records as unknown[])
        : [];
    if (records.length > 1) {
      throw new ConnectorRejectedError('salesforce returned multiple contacts for one email', 300);
    }
    const existingId = records.length > 0 ? recordId(records[0]) : undefined;
    if (existingId !== undefined) {
      const response = await this.request(
        connection,
        `/services/data/v68.0/sobjects/Contact/${encodeURIComponent(existingId)}`,
        'PATCH',
        fields,
        event.id,
      );
      await readProviderResponse(response, 'salesforce');
      return contactResult(event, response, existingId, 'contact');
    }
    const response = await this.request(
      connection,
      '/services/data/v68.0/sobjects/Contact',
      'POST',
      fields,
      event.id,
    );
    const result = await readProviderResponse(response, 'salesforce');
    return contactResult(event, response, recordId(result), 'contact');
  }
}

function recordId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = 'id' in value ? value.id : 'Id' in value ? value.Id : undefined;
  return typeof id === 'string' ? id : undefined;
}
