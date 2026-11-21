// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../../../common/config';
import type { IntegrationConnection, IntegrationEvent } from '../connector';
import {
  ConnectorAuthError,
  ConnectorRejectedError,
  ConnectorTransientError,
} from '../rest-crm-connector';
import { HubSpotConnector } from './index';

const config = { crawl: { userAgent: 'AiLoomTest/1.0' } } as AppConfig;

const connection: IntegrationConnection = {
  id: '0190b000-0000-7000-8000-000000000053',
  workspaceId: '0190b000-0000-7000-8000-000000000054',
  provider: 'hubspot',
  scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
  externalAccountId: 'account-1',
  settings: { transcriptSharing: false },
  credentials: { accessToken: 'secret' },
};

const event: IntegrationEvent = {
  id: '0190b000-0000-7000-8000-000000000055',
  type: 'contact.updated',
  workspaceId: connection.workspaceId,
  aggregateId: '0190b000-0000-7000-8000-000000000056',
  occurredAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  data: {
    contactId: '0190b000-0000-7000-8000-000000000056',
    externalId: 'customer-1',
    email: ' CUSTOMER@example.com ',
    name: 'Ada Lovelace',
    privateAttribute: 'must not leave AiLoom',
  },
};

type Request = (
  connection: IntegrationConnection,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
  idempotencyKey?: string,
) => Promise<Response>;

describe('HubSpot connector contract', () => {
  it('upserts contacts by normalized email using HubSpot batch API fields', async () => {
    const connector = new HubSpotConnector(config);
    const request = vi
      .spyOn(connector as unknown as { request: Request }, 'request')
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ id: 'hubspot-contact-1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await expect(connector.handle(event, connection)).resolves.toEqual({
      externalObjectId: 'hubspot-contact-1',
      externalObjectType: 'contact',
      idempotencyKey: event.id,
      statusCode: 200,
    });
    expect(request).toHaveBeenCalledWith(
      connection,
      '/crm/v3/objects/contacts/batch/upsert',
      'POST',
      {
        inputs: [
          {
            id: 'customer@example.com',
            idProperty: 'email',
            objectWriteTraceId: event.id,
            properties: {
              email: 'customer@example.com',
              firstname: 'Ada',
              lastname: 'Lovelace',
            },
          },
        ],
      },
      event.id,
    );
    expect(connector.capabilities).toEqual(['contacts']);
    expect(connector.supportsEvent('handoff.requested')).toBe(false);
  });

  it('skips contact events without an email rather than creating an unmatchable record', async () => {
    const connector = new HubSpotConnector(config);
    const request = vi.spyOn(connector as unknown as { request: Request }, 'request');

    await expect(
      connector.handle(
        { ...event, data: { contactId: event.aggregateId, name: 'No Email' } },
        connection,
      ),
    ).resolves.toEqual({ skippedReason: 'missing_email' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [401, ConnectorAuthError],
    [403, ConnectorAuthError],
    [429, ConnectorTransientError],
    [503, ConnectorTransientError],
    [422, ConnectorRejectedError],
  ] as const)('classifies HubSpot HTTP %s responses', async (status, ErrorType) => {
    const connector = new HubSpotConnector(config);
    vi.spyOn(connector as unknown as { request: Request }, 'request').mockResolvedValue(
      new Response('provider error', { status }),
    );

    await expect(connector.handle(event, connection)).rejects.toBeInstanceOf(ErrorType);
  });
});
