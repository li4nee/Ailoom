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
export class Dynamics365Connector extends RestCrmConnector {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(CONNECTOR_FETCH) fetcher?: ConnectorFetch,
  ) {
    super(
      {
        provider: 'dynamics365',
        capabilities: ['contacts'],
        baseUrl: 'https://org.crm.dynamics.com',
        healthPath: '/api/data/v9.2/WhoAmI()',
        contactPath: '/api/data/v9.2/contacts',
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
      emailaddress1: identity.email,
      ...(lastName === '' ? {} : { firstname: firstName }),
      lastname: lastName || firstName,
    };
    const escapedEmail = identity.email.replaceAll("'", "''");
    const filter = encodeURIComponent(`emailaddress1 eq '${escapedEmail}'`);
    const searchResponse = await this.request(
      connection,
      `/api/data/v9.2/contacts?$select=contactid&$filter=${filter}&$top=2`,
      'GET',
      undefined,
      undefined,
      { accept: 'application/json', 'odata-version': '4.0', 'odata-maxversion': '4.0' },
    );
    const search = await readProviderResponse(searchResponse, 'dynamics365');
    const rows =
      typeof search === 'object' &&
      search !== null &&
      'value' in search &&
      Array.isArray(search.value)
        ? (search.value as unknown[])
        : [];
    if (rows.length > 1) {
      throw new ConnectorRejectedError('dynamics365 returned multiple contacts for one email', 409);
    }
    const existingId = rows.length > 0 ? recordId(rows[0]) : undefined;
    if (existingId !== undefined) {
      const response = await this.request(
        connection,
        `/api/data/v9.2/contacts(${encodeURIComponent(existingId)})`,
        'PATCH',
        fields,
        event.id,
        { accept: 'application/json', 'odata-version': '4.0', 'odata-maxversion': '4.0' },
      );
      await readProviderResponse(response, 'dynamics365');
      return contactResult(event, response, existingId, 'contact');
    }
    const response = await this.request(
      connection,
      '/api/data/v9.2/contacts',
      'POST',
      fields,
      event.id,
      {
        accept: 'application/json',
        'odata-version': '4.0',
        'odata-maxversion': '4.0',
        prefer: 'return=representation',
      },
    );
    const result = await readProviderResponse(response, 'dynamics365');
    const headerId = response.headers.get('odata-entityid')?.match(/contacts\(([^)]+)\)/iu)?.[1];
    return contactResult(event, response, headerId ?? recordId(result), 'contact');
  }
}

function recordId(value: unknown): string | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'contactid' in value &&
    typeof value.contactid === 'string'
    ? value.contactid
    : undefined;
}
