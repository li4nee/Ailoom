// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../../common/config';
import type { FetchPolicy } from '../../../common/safe-fetch';
import type { IntegrationConnection, IntegrationEvent } from './connector';
import {
  Dynamics365Connector,
  FreshdeskConnector,
  IntercomConnector,
  PipedriveConnector,
  SalesforceConnector,
  ZendeskConnector,
  ZohoConnector,
} from './index';
import type { ConnectorFetch } from './rest-crm-connector';

const config = { crawl: { userAgent: 'AiLoomTest/1.0' } } as AppConfig;

const event: IntegrationEvent = {
  id: '0190b000-0000-7000-8000-000000000055',
  type: 'contact.updated',
  workspaceId: '0190b000-0000-7000-8000-000000000054',
  aggregateId: '0190b000-0000-7000-8000-000000000056',
  occurredAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  data: {
    contactId: '0190b000-0000-7000-8000-000000000056',
    externalId: 'customer-1',
    email: ' CUSTOMER@example.com ',
    name: 'Ada Lovelace',
    arbitrary: 'must not be sent',
  },
};

interface CapturedRequest {
  url: string;
  init: RequestInit;
  policy: FetchPolicy;
}

function fakeFetch(...responses: Response[]): {
  fetcher: ConnectorFetch;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetcher: ConnectorFetch = (input, init, policy) => {
    requests.push({ url: String(input), init, policy });
    const response = responses.shift();
    return response === undefined
      ? Promise.reject(new Error('Unexpected provider request.'))
      : Promise.resolve(response);
  };
  return { fetcher, requests };
}

function connection(
  provider: IntegrationConnection['provider'],
  credentials: IntegrationConnection['credentials'] = {
    accessToken: 'secret',
    baseUrl: 'https://tenant.crm.test',
  },
): IntegrationConnection {
  return {
    id: '0190b000-0000-7000-8000-000000000053',
    workspaceId: event.workspaceId,
    provider,
    scopes: [],
    externalAccountId: null,
    settings: { transcriptSharing: false },
    credentials,
  };
}

function bodyAt(request: CapturedRequest): unknown {
  const body = request.init.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(body) as unknown;
}

describe('provider CRM contact contracts', () => {
  it('uses Salesforce sObject fields and patches an exact email match', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json({ records: [{ Id: '003-contact' }] }),
      new Response(null, { status: 204 }),
    );
    const connector = new SalesforceConnector(config, fetcher);

    await expect(connector.handle(event, connection('salesforce'))).resolves.toMatchObject({
      externalObjectId: '003-contact',
      externalObjectType: 'contact',
    });
    expect(requests[0]?.url).toContain('/services/data/v68.0/query?q=');
    expect(requests[1]?.url).toBe(
      'https://tenant.crm.test/services/data/v68.0/sobjects/Contact/003-contact',
    );
    expect(bodyAt(requests[1]!)).toEqual({
      Email: 'customer@example.com',
      FirstName: 'Ada',
      LastName: 'Lovelace',
    });
  });

  it('creates a Salesforce contact and reads the lowercase sObject response id', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json({ records: [] }),
      Response.json({ id: '003-new', success: true, errors: [] }, { status: 201 }),
    );
    const connector = new SalesforceConnector(config, fetcher);

    await expect(connector.handle(event, connection('salesforce'))).resolves.toMatchObject({
      externalObjectId: '003-new',
      externalObjectType: 'contact',
    });
    expect(requests[1]?.init.method).toBe('POST');
    expect(requests[1]?.url).toBe('https://tenant.crm.test/services/data/v68.0/sobjects/Contact');
  });

  it('uses Dataverse properties and updates a contact found by email', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json({ value: [{ contactid: 'contact-guid' }] }),
      new Response(null, { status: 204 }),
    );
    const connector = new Dynamics365Connector(config, fetcher);

    await expect(connector.handle(event, connection('dynamics365'))).resolves.toMatchObject({
      externalObjectId: 'contact-guid',
      externalObjectType: 'contact',
    });
    expect(requests[0]?.url).toContain('/contacts?$select=contactid&$filter=');
    expect(bodyAt(requests[1]!)).toEqual({
      emailaddress1: 'customer@example.com',
      firstname: 'Ada',
      lastname: 'Lovelace',
    });
  });

  it('creates a Dataverse contact and reads the OData entity id header', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json({ value: [] }),
      new Response(null, {
        status: 204,
        headers: {
          'OData-EntityId':
            'https://tenant.crm.test/api/data/v9.2/contacts(00000000-0000-0000-0000-000000000001)',
        },
      }),
    );
    const connector = new Dynamics365Connector(config, fetcher);

    await expect(connector.handle(event, connection('dynamics365'))).resolves.toMatchObject({
      externalObjectId: '00000000-0000-0000-0000-000000000001',
      externalObjectType: 'contact',
    });
    expect(requests[1]?.init.method).toBe('POST');
    expect(bodyAt(requests[1]!)).toEqual({
      emailaddress1: 'customer@example.com',
      firstname: 'Ada',
      lastname: 'Lovelace',
    });
  });

  it('uses Zoho v8 auth and the data/duplicate-check envelope', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json({ data: [{ details: { id: 'zoho-contact' }, status: 'success' }] }),
    );
    const connector = new ZohoConnector(config, fetcher);

    await expect(connector.handle(event, connection('zoho'))).resolves.toMatchObject({
      externalObjectId: 'zoho-contact',
      externalObjectType: 'contact',
    });
    expect(requests[0]?.url).toBe('https://tenant.crm.test/crm/v8/Contacts/upsert');
    expect(requests[0]?.init.headers).toMatchObject({ authorization: 'Zoho-oauthtoken secret' });
    expect(bodyAt(requests[0]!)).toEqual({
      data: [{ Email: 'customer@example.com', First_Name: 'Ada', Last_Name: 'Lovelace' }],
      duplicate_check_fields: ['Email'],
    });
  });

  it('searches and updates a Pipedrive person with the v2 contact shape', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json({ data: { items: [{ item: { id: 123 } }] } }),
      Response.json({ success: true, data: { id: 123 } }),
    );
    const connector = new PipedriveConnector(config, fetcher);

    await expect(connector.handle(event, connection('pipedrive'))).resolves.toMatchObject({
      externalObjectId: '123',
      externalObjectType: 'person',
    });
    expect(requests[0]?.url).toContain('/api/v2/persons/search?');
    expect(requests[1]?.url).toBe('https://tenant.crm.test/api/v2/persons/123');
    expect(requests[1]?.init.method).toBe('PUT');
    expect(bodyAt(requests[1]!)).toEqual({
      name: 'Ada Lovelace',
      emails: [{ value: 'customer@example.com', primary: true }],
    });
  });

  it('creates a Pipedrive person when exact email search has no match', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json({ data: { items: [] } }),
      Response.json({ success: true, data: { id: 333 } }, { status: 201 }),
    );
    const connector = new PipedriveConnector(config, fetcher);

    await expect(connector.handle(event, connection('pipedrive'))).resolves.toMatchObject({
      externalObjectId: '333',
      externalObjectType: 'person',
    });
    expect(requests[1]?.init.method).toBe('POST');
    expect(requests[1]?.url).toBe('https://tenant.crm.test/api/v2/persons');
  });

  it('uses Zendesk create-or-update and supports API-token Basic auth', async () => {
    const { fetcher, requests } = fakeFetch(Response.json({ user: { id: 456 } }));
    const connector = new ZendeskConnector(config, fetcher);

    await expect(
      connector.handle(
        event,
        connection('zendesk', {
          accessToken: 'zd-token',
          authMode: 'api_key',
          authUser: 'agent@example.com',
          baseUrl: 'https://acme.zendesk.com',
        }),
      ),
    ).resolves.toMatchObject({ externalObjectId: '456', externalObjectType: 'user' });
    expect(requests[0]?.url).toBe('https://acme.zendesk.com/api/v2/users/create_or_update.json');
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('agent@example.com/token:zd-token').toString('base64')}`,
    });
    expect(bodyAt(requests[0]!)).toEqual({
      user: { name: 'Ada Lovelace', email: 'customer@example.com', external_id: 'customer-1' },
    });
  });

  it('pins Intercom API version and updates an identity after a duplicate create response', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json(
        {
          errors: [
            {
              code: 'conflict',
              message: 'A contact matching those details already exists with id=ic-789',
            },
          ],
        },
        { status: 409 },
      ),
      Response.json({ id: 'ic-789' }),
    );
    const connector = new IntercomConnector(config, fetcher);

    await expect(connector.handle(event, connection('intercom'))).resolves.toMatchObject({
      externalObjectId: 'ic-789',
      externalObjectType: 'contact',
    });
    expect(requests[0]?.init.headers).toMatchObject({ 'Intercom-Version': '2.18' });
    expect(bodyAt(requests[0]!)).toEqual({
      role: 'user',
      email: 'customer@example.com',
      external_id: 'customer-1',
      name: 'Ada Lovelace',
    });
    expect(requests[1]?.url).toBe('https://tenant.crm.test/contacts/ic-789');
    expect(requests[1]?.init.method).toBe('PUT');
  });

  it('creates an Intercom contact and returns its contact id', async () => {
    const { fetcher, requests } = fakeFetch(Response.json({ id: 'ic-new' }, { status: 201 }));
    const connector = new IntercomConnector(config, fetcher);

    await expect(connector.handle(event, connection('intercom'))).resolves.toMatchObject({
      externalObjectId: 'ic-new',
      externalObjectType: 'contact',
    });
    expect(requests[0]?.url).toBe('https://tenant.crm.test/contacts');
  });

  it('uses Freshdesk Basic auth and updates an exact-email contact match', async () => {
    const { fetcher, requests } = fakeFetch(
      Response.json([{ id: 789, email: 'customer@example.com' }]),
      Response.json({ id: 789 }),
    );
    const connector = new FreshdeskConnector(config, fetcher);

    await expect(
      connector.handle(
        event,
        connection('freshdesk', {
          accessToken: 'fd-api-key',
          authMode: 'api_key',
          baseUrl: 'https://acme.freshdesk.com',
        }),
      ),
    ).resolves.toMatchObject({ externalObjectId: '789', externalObjectType: 'contact' });
    expect(requests[0]?.url).toContain(
      'https://acme.freshdesk.com/api/v2/contacts/autocomplete?term=',
    );
    expect(requests[1]?.url).toBe('https://acme.freshdesk.com/api/v2/contacts/789');
    expect(requests[1]?.init.method).toBe('PUT');
    expect(requests[1]?.init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('fd-api-key:X').toString('base64')}`,
    });
    expect(bodyAt(requests[1]!)).toEqual({ name: 'Ada Lovelace', email: 'customer@example.com' });
  });

  it('creates a Freshdesk contact when autocomplete has no exact-email match', async () => {
    const { fetcher, requests } = fakeFetch(Response.json([]), Response.json({ id: 790 }));
    const connector = new FreshdeskConnector(config, fetcher);

    await expect(
      connector.handle(
        event,
        connection('freshdesk', {
          accessToken: 'fd-api-key',
          authMode: 'api_key',
          baseUrl: 'https://acme.freshdesk.com',
        }),
      ),
    ).resolves.toMatchObject({ externalObjectId: '790', externalObjectType: 'contact' });
    expect(requests[1]?.init.method).toBe('POST');
    expect(requests[1]?.url).toBe('https://acme.freshdesk.com/api/v2/contacts');
  });

  it.each([
    [new SalesforceConnector(config), 'salesforce'],
    [new Dynamics365Connector(config), 'dynamics365'],
    [new ZohoConnector(config), 'zoho'],
    [new ZendeskConnector(config), 'zendesk'],
    [new FreshdeskConnector(config), 'freshdesk'],
  ] as const)('%s rejects writes without a tenant URL', async (connector, provider) => {
    await expect(
      connector.handle(event, connection(provider, { accessToken: 'secret' })),
    ).rejects.toThrow(/tenant URL is required/u);
  });
});
