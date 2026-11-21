// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import type { IntegrationEventType } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../../../common/config';
import type { ConnectorHandleResult, IntegrationConnection, IntegrationEvent } from '../connector';
import {
  ConnectorAuthError,
  ConnectorRejectedError,
  ConnectorTransientError,
  RestCrmConnector,
} from '../rest-crm-connector';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Injectable()
export class HubSpotConnector extends RestCrmConnector {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(
      {
        provider: 'hubspot',
        capabilities: ['contacts'],
        baseUrl: 'https://api.hubapi.com',
        healthPath: '/crm/v3/objects/contacts?limit=1',
        contactPath: '/crm/v3/objects/contacts/batch/upsert',
        contactObjectType: 'contact',
        handoffPath: null,
        handoffObjectType: null,
        timelinePath: null,
      },
      config,
    );
  }

  override supportsEvent(type: IntegrationEventType): boolean {
    return type === 'contact.created' || type === 'contact.updated';
  }

  override async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    if (event.type !== 'contact.created' && event.type !== 'contact.updated') {
      return { skippedReason: 'unsupported_event' };
    }
    if (typeof event.data !== 'object' || event.data === null) {
      return { skippedReason: 'missing_email' };
    }

    const data = event.data as Record<string, unknown>;
    const email = typeof data['email'] === 'string' ? data['email'].trim().toLowerCase() : '';
    if (email === '') return { skippedReason: 'missing_email' };

    const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
    const [firstName, ...lastNameParts] = name.split(/\s+/u).filter(Boolean);
    const properties = {
      email,
      ...(firstName === undefined ? {} : { firstname: firstName }),
      ...(lastNameParts.length === 0 ? {} : { lastname: lastNameParts.join(' ') }),
    };
    const response = await this.request(
      connection,
      '/crm/v3/objects/contacts/batch/upsert',
      'POST',
      {
        inputs: [
          {
            id: email,
            idProperty: 'email',
            objectWriteTraceId: event.id,
            properties,
          },
        ],
      },
      event.id,
    );
    const raw = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorAuthError('hubspot authentication was rejected', response.status);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ConnectorTransientError(
        `hubspot returned ${String(response.status)}`,
        response.status,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorRejectedError(
        `hubspot returned ${String(response.status)}`,
        response.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new ConnectorRejectedError(
        'hubspot returned an invalid upsert response',
        response.status,
      );
    }
    const results = isRecord(parsed) ? parsed['results'] : undefined;
    const firstResult: unknown = Array.isArray(results) ? results[0] : undefined;
    const externalObjectId =
      isRecord(firstResult) && typeof firstResult['id'] === 'string'
        ? firstResult['id']
        : undefined;
    if (externalObjectId === undefined) {
      throw new ConnectorRejectedError(
        'hubspot upsert response did not include a contact id',
        response.status,
      );
    }

    return {
      externalObjectId,
      externalObjectType: 'contact',
      idempotencyKey: event.id,
      statusCode: response.status,
    };
  }
}
