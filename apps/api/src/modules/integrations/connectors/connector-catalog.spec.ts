// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { type AppConfig } from '../../../common/config';
import {
  Dynamics365Connector,
  FreshdeskConnector,
  HubSpotConnector,
  IntercomConnector,
  PipedriveConnector,
  SalesforceConnector,
  ZendeskConnector,
  ZohoConnector,
} from './index';

const config = { crawl: { userAgent: 'AiLoomTest/1.0' } } as AppConfig;

describe('CRM connector catalog', () => {
  it.each([
    [HubSpotConnector, 'hubspot'],
    [SalesforceConnector, 'salesforce'],
    [Dynamics365Connector, 'dynamics365'],
    [ZohoConnector, 'zoho'],
    [PipedriveConnector, 'pipedrive'],
    [ZendeskConnector, 'zendesk'],
    [IntercomConnector, 'intercom'],
    [FreshdeskConnector, 'freshdesk'],
  ] as const)('%s declares the %s provider contract', (Connector, provider) => {
    const connector = new Connector(config);

    expect(connector.provider).toBe(provider);
    expect(connector.capabilities.length).toBeGreaterThan(0);
    expect(typeof connector.handle).toBe('function');
  });
});
