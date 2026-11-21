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

const INTERCOM_VERSION = '2.18';

@Injectable()
export class IntercomConnector extends RestCrmConnector {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(CONNECTOR_FETCH) fetcher?: ConnectorFetch,
  ) {
    super(
      {
        provider: 'intercom',
        capabilities: ['contacts'],
        baseUrl: 'https://api.intercom.io',
        healthPath: '/me',
        contactPath: '/contacts',
        contactObjectType: 'contact',
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
    return {
      authorization: `Bearer ${connection.credentials.accessToken}`,
      'Intercom-Version': INTERCOM_VERSION,
    };
  }

  override async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    const identity = contactIdentity(event);
    if (identity === null) return { skippedReason: 'missing_identity' };
    const fields = {
      role: 'user',
      ...(identity.email === '' ? {} : { email: identity.email }),
      ...(identity.externalId === null ? {} : { external_id: identity.externalId }),
      ...(identity.name === '' ? {} : { name: identity.name }),
    };
    const headers = { 'Intercom-Version': INTERCOM_VERSION };
    const create = await this.request(connection, '/contacts', 'POST', fields, event.id, headers);
    if (create.status !== 409) {
      const result = await readProviderResponse(create, 'intercom');
      return contactResult(event, create, getId(result), 'contact');
    }

    const rawConflict = await create.text();
    const existingId = conflictContactId(rawConflict);
    if (existingId === undefined) {
      throw new ConnectorRejectedError(
        'intercom reported an existing contact without a contact id',
        create.status,
      );
    }
    const update = await this.request(
      connection,
      `/contacts/${encodeURIComponent(existingId)}`,
      'PUT',
      fields,
      event.id,
      headers,
    );
    const result = await readProviderResponse(update, 'intercom');
    return contactResult(event, update, getId(result) ?? existingId, 'contact');
  }
}

function getId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('id' in value)) return undefined;
  return typeof value.id === 'string' ? value.id : undefined;
}

function conflictContactId(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('errors' in parsed) ||
      !Array.isArray(parsed.errors)
    ) {
      return undefined;
    }
    const first = parsed.errors[0] as unknown;
    if (
      typeof first !== 'object' ||
      first === null ||
      !('message' in first) ||
      typeof first.message !== 'string'
    ) {
      return undefined;
    }
    return /\bid=([A-Za-z0-9_-]+)\b/u.exec(first.message)?.[1];
  } catch {
    return undefined;
  }
}
