// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import type { IntegrationProvider } from '@app/shared';

import { loadConfig } from '../../common/config';
import { OAuthFlowService } from './oauth-flow.service';

const validEnv = {
  PUBLIC_URL: 'https://support.example.com',
  DATABASE_URL: 'postgres://app:pass@localhost/ailoom',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'0'.repeat(64)}`,
  CRM_OAUTH_CLIENTS: JSON.stringify({
    hubspot: { clientId: 'hub-client', clientSecret: 'hub-secret' },
    salesforce: { clientId: 'sf-client', clientSecret: 'sf-secret' },
    dynamics365: { clientId: 'd365-client', clientSecret: 'd365-secret' },
    zoho: { clientId: 'zoho-client', clientSecret: 'zoho-secret' },
    pipedrive: { clientId: 'pipe-client', clientSecret: 'pipe-secret' },
    zendesk: { clientId: 'zen-client', clientSecret: 'zen-secret' },
    intercom: { clientId: 'intercom-client', clientSecret: 'intercom-secret' },
  }),
};

describe('OAuthFlowService', () => {
  it('persists hashed, short-lived state and builds the provider authorization URL', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const service = new OAuthFlowService({ query } as never, loadConfig(validEnv));

    const result = await service.start({
      workspaceId: '0190b000-0000-7000-8000-000000000013',
      actorUserId: '0190b000-0000-7000-8000-000000000014',
      provider: 'hubspot',
      name: 'Support HubSpot',
      returnUrl: 'https://support.example.com/w/workspace/settings/integrations',
    });

    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://app.hubspot.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('hub-client');
    expect(url.searchParams.get('scope')).toBe(
      'crm.objects.contacts.read crm.objects.contacts.write',
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://support.example.com/v1/integrations/oauth/callback/hubspot',
    );
    const rawState = url.searchParams.get('state');
    expect(rawState).toMatch(/^[\w-]{43}$/u);
    expect(query).toHaveBeenCalledTimes(2);
    const insertValues = query.mock.calls[0]?.[1] as unknown[];
    expect(insertValues[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(insertValues[0]).not.toBe(rawState);
  });

  it.each([
    ['https://acme.my.salesforce.com', 'https://login.salesforce.com'],
    ['https://test.salesforce.com', 'https://test.salesforce.com'],
    ['https://acme--dev.sandbox.my.salesforce.com', 'https://test.salesforce.com'],
    // Lookalike hosts that merely contain a sandbox marker are not sandbox tenants.
    ['https://test.salesforce.com.example.net', 'https://login.salesforce.com'],
    ['https://acme.sandbox.example.net', 'https://login.salesforce.com'],
  ])('chooses the Salesforce login host for %s by hostname', async (baseUrl, origin) => {
    const query = vi.fn().mockResolvedValue(undefined);
    const service = new OAuthFlowService({ query } as never, loadConfig(validEnv));

    const result = await service.start({
      workspaceId: '0190b000-0000-7000-8000-000000000013',
      actorUserId: '0190b000-0000-7000-8000-000000000014',
      provider: 'salesforce',
      name: 'Support Salesforce',
      baseUrl,
      returnUrl: 'https://support.example.com/w/workspace/settings/integrations',
    });

    expect(new URL(result.authorizationUrl).origin).toBe(origin);
  });

  it('rejects an OAuth return URL outside the AiLoom instance', async () => {
    const query = vi.fn();
    const service = new OAuthFlowService({ query } as never, loadConfig(validEnv));

    await expect(
      service.start({
        workspaceId: '0190b000-0000-7000-8000-000000000013',
        actorUserId: '0190b000-0000-7000-8000-000000000014',
        provider: 'hubspot',
        name: 'Support HubSpot',
        returnUrl: 'https://attacker.example/steal',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(query).not.toHaveBeenCalled();
  });

  it('consumes state once and exchanges a HubSpot code without returning tokens to the browser', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        workspaceId: '0190b000-0000-7000-8000-000000000013',
        actorUserId: '0190b000-0000-7000-8000-000000000014',
        provider: 'hubspot',
        name: 'Support HubSpot',
        baseUrl: null,
        scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
        returnUrl: 'https://support.example.com/w/workspace/settings/integrations',
      },
    ]);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'short-lived-token',
          refresh_token: 'refresh-token',
          expires_in: 1800,
          hub_id: 42,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new OAuthFlowService(
      { query } as never,
      loadConfig(validEnv),
      fetcher as never,
    );

    const result = await service.complete(
      'hubspot',
      'state-token-that-is-long-enough-for-callback',
      'authorization-code',
      new URLSearchParams(),
    );

    expect(query).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.hubapi.com/oauth/v3/token');
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).body).toMatch(/client_secret=hub-secret/u);
    expect(result.credentials.accessToken).toBe('short-lived-token');
    expect(result.credentials.refreshToken).toBe('refresh-token');
    expect(result.externalAccountId).toBe('42');
    expect(result.returnUrl).toContain('/settings/integrations');
  });

  it('rotates an expired HubSpot OAuth token using its refresh token', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 1800,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new OAuthFlowService(
      { query: vi.fn() } as never,
      loadConfig(validEnv),
      fetcher as never,
    );

    const updated = await service.refresh('hubspot', {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      authMode: 'bearer',
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.hubapi.com/oauth/v3/token');
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).body).toMatch(/grant_type=refresh_token/u);
    expect(updated.accessToken).toBe('new-access');
    expect(updated.refreshToken).toBe('new-refresh');
    expect(Date.parse(updated.tokenExpiresAt ?? '')).toBeGreaterThan(Date.now());
  });

  it.each([
    [
      'hubspot',
      undefined,
      'https://app.hubspot.com/oauth/authorize',
      'https://api.hubapi.com/oauth/v3/token',
    ],
    [
      'salesforce',
      'https://acme.my.salesforce.com',
      'https://login.salesforce.com/services/oauth2/authorize',
      'https://login.salesforce.com/services/oauth2/token',
    ],
    [
      'dynamics365',
      'https://acme.crm.dynamics.com',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    ],
    [
      'zoho',
      'https://www.zohoapis.com',
      'https://accounts.zoho.com/oauth/v2/auth',
      'https://accounts.zoho.com/oauth/v2/token',
    ],
    [
      'pipedrive',
      undefined,
      'https://oauth.pipedrive.com/oauth/authorize',
      'https://oauth.pipedrive.com/oauth/token',
    ],
    [
      'zendesk',
      'https://acme.zendesk.com',
      'https://acme.zendesk.com/oauth/authorizations/new',
      'https://acme.zendesk.com/oauth/tokens',
    ],
    [
      'intercom',
      undefined,
      'https://app.intercom.com/oauth',
      'https://api.intercom.io/auth/eagle/token',
    ],
    [
      'intercom',
      'https://api.eu.intercom.io',
      'https://app.eu.intercom.com/oauth',
      'https://api.eu.intercom.io/auth/eagle/token',
    ],
    [
      'intercom',
      'https://api.au.intercom.io',
      'https://app.au.intercom.com/oauth',
      'https://api.au.intercom.io/auth/eagle/token',
    ],
  ] as const)(
    '%s uses its provider authorization and token endpoints',
    async (rawProvider, baseUrl, authEndpoint, expectedTokenEndpoint) => {
      const provider = rawProvider as IntegrationProvider;
      const scopes =
        provider === 'hubspot' ? ['crm.objects.contacts.read', 'crm.objects.contacts.write'] : [];
      const pending = {
        workspaceId: '0190b000-0000-7000-8000-000000000013',
        actorUserId: '0190b000-0000-7000-8000-000000000014',
        provider,
        name: `CRM ${provider}`,
        baseUrl: baseUrl ?? null,
        scopes,
        returnUrl: 'https://support.example.com/w/workspace/settings/integrations',
      };
      const query = vi.fn((sql: string) =>
        Promise.resolve(sql.includes('RETURNING') ? [pending] : []),
      );
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'provider-access',
            token: 'provider-access',
            refresh_token: 'provider-refresh',
            expires_in: 3600,
            api_domain: 'https://www.zohoapis.com',
            instance_url: 'https://acme.my.salesforce.com',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      const service = new OAuthFlowService(
        { query } as never,
        loadConfig(validEnv),
        fetcher as never,
      );
      const start = await service.start({
        workspaceId: pending.workspaceId,
        actorUserId: pending.actorUserId,
        provider,
        name: pending.name,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        returnUrl: pending.returnUrl,
      });
      const authorization = new URL(start.authorizationUrl);
      expect(`${authorization.origin}${authorization.pathname}`).toBe(authEndpoint);
      expect(authorization.searchParams.get('client_secret')).toBeNull();

      const completion = await service.complete(
        provider,
        authorization.searchParams.get('state') ?? '',
        'one-time-code',
        new URLSearchParams(
          provider === 'zoho' ? { 'accounts-server': 'https://accounts.zoho.com' } : {},
        ),
      );

      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]?.[0]).toBe(expectedTokenEndpoint);
      expect(completion.credentials.accessToken).toBe('provider-access');
      expect(completion.workspaceId).toBe(pending.workspaceId);
    },
  );
});
