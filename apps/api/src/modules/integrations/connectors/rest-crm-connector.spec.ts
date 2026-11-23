// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../../common/config';
import type { IntegrationConnection } from './connector';
import { RestCrmConnector, type CrmConnectorSpec } from './rest-crm-connector';

const config = {
  crawl: { userAgent: 'AiLoomTest/1.0' },
} as AppConfig;

const connection: IntegrationConnection = {
  id: '0190b000-0000-7000-8000-000000000053',
  workspaceId: '0190b000-0000-7000-8000-000000000054',
  provider: 'hubspot',
  scopes: ['contacts'],
  externalAccountId: 'account-1',
  settings: { transcriptSharing: false, crmContextFields: null },
  credentials: { accessToken: 'secret', baseUrl: 'https://crm.test' },
};

const spec: CrmConnectorSpec = {
  provider: 'hubspot',
  capabilities: ['contacts', 'tickets', 'timeline'],
  baseUrl: 'https://api.hubapi.com',
  healthPath: '/health',
  contactPath: '/contacts',
  contactObjectType: 'contact',
  handoffPath: '/tickets',
  handoffObjectType: 'ticket',
  timelinePath: '/timeline',
};

describe('RestCrmConnector contract', () => {
  it('uses safeFetch, bearer auth, and event idempotency for contact upserts', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'external-contact-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const connector = new RestCrmConnector(spec, config, fetcher);

    const result = await connector.handle(
      {
        id: '0190b000-0000-7000-8000-000000000055',
        type: 'contact.updated',
        workspaceId: connection.workspaceId,
        aggregateId: '0190b000-0000-7000-8000-000000000056',
        occurredAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        data: {
          contactId: '0190b000-0000-7000-8000-000000000056',
          externalId: 'customer-1',
          email: 'customer@example.com',
          name: 'Customer',
          ignored: 'not mapped',
        },
      },
      connection,
    );

    expect(result).toEqual({
      externalObjectId: 'external-contact-1',
      externalObjectType: 'contact',
      idempotencyKey: '0190b000-0000-7000-8000-000000000055',
      statusCode: 201,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://crm.test/contacts',
      expect.objectContaining({
        method: 'POST',
      }),
      expect.objectContaining({ name: 'webhook' }),
    );
    const call = fetcher.mock.calls.at(0) as [string, RequestInit, unknown] | undefined;
    expect(call?.[1].headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer secret',
        'idempotency-key': '0190b000-0000-7000-8000-000000000055',
      }),
    );
    const body = call?.[1].body;
    expect(typeof body).toBe('string');
    expect(body).toContain('customer@example.com');
    expect(body).not.toContain('ignored');
  });

  it('returns a documented no-op for unsupported event capabilities', async () => {
    const fetcher = vi.fn();
    const connector = new RestCrmConnector(
      { ...spec, handoffPath: null, handoffObjectType: null },
      config,
      fetcher,
    );

    await expect(
      connector.handle(
        {
          id: '0190b000-0000-7000-8000-000000000057',
          type: 'handoff.requested',
          workspaceId: connection.workspaceId,
          aggregateId: connection.id,
          occurredAt: '2026-01-01T00:00:00.000Z',
          version: 1,
          data: {},
        },
        connection,
      ),
    ).resolves.toEqual({ skippedReason: 'unsupported_event' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
