// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { CrmContextFieldMap, IntegrationProvider } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { safeFetch, webhookPolicy } from '../../common/safe-fetch';
import type { IntegrationCredentials } from './connectors/connector';
import { ConnectorAuthError } from './connectors/rest-crm-connector';
import type { IntegrationOAuthStateEntity } from './integration-oauth-state.entity';

const STATE_TTL_MS = 10 * 60_000;
const CALLBACK_PATH = '/v1/integrations/oauth/callback';
type OAuthFetcher = typeof safeFetch;
const OAUTH_FETCHER = Symbol('OAUTH_FETCHER');

interface StartOAuthInput {
  workspaceId: string;
  actorUserId: string;
  provider: IntegrationProvider;
  name: string;
  baseUrl?: string;
  scopes?: string[];
  returnUrl: string;
  crmContextFields?: CrmContextFieldMap;
}

interface OAuthCompletion {
  workspaceId: string;
  actorUserId: string;
  provider: IntegrationProvider;
  name: string;
  scopes: string[];
  returnUrl: string;
  credentials: IntegrationCredentials & {
    refreshToken?: string;
    tokenExpiresAt?: string;
  };
  externalAccountId: string | null;
  crmContextFields: CrmContextFieldMap | null;
}

interface TokenResponse extends Record<string, unknown> {
  access_token?: string;
  token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  expires_in_sec?: number | string;
  instance_url?: string;
  api_domain?: string;
  hub_id?: number | string;
  company_id?: number | string;
}

@Injectable()
export class OAuthFlowService {
  constructor(
    private readonly ds: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(OAUTH_FETCHER) fetcher?: OAuthFetcher,
  ) {
    this.fetcher = fetcher ?? safeFetch;
  }

  private readonly fetcher: OAuthFetcher;

  async start(input: StartOAuthInput): Promise<{ authorizationUrl: string }> {
    const client = this.config.crmOAuthClients[input.provider];
    if (client === undefined || input.provider === 'freshdesk') {
      throw new AppError('conflict', {
        message: `OAuth is not configured for ${input.provider}.`,
      });
    }
    const baseUrl = validateProviderBaseUrl(input.provider, input.baseUrl);
    const returnUrl = validateReturnUrl(input.returnUrl, this.config);
    const state = randomBytes(32).toString('base64url');
    const stateHash = createHash('sha256').update(state).digest('hex');
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);
    // OAuth asks for the adapter's least-privilege defaults. The setup form's scopes field is
    // only an audit note for manually supplied credentials and must not broaden consent.
    const scopes = normalizeScopes(input.provider, []);

    await this.ds.query(
      `INSERT INTO integration_oauth_states
        (state_hash, workspace_id, actor_user_id, provider, name, base_url, scopes, return_url, expires_at, crm_context_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        stateHash,
        input.workspaceId,
        input.actorUserId,
        input.provider,
        input.name,
        baseUrl,
        scopes,
        returnUrl,
        expiresAt,
        input.crmContextFields ?? null,
      ],
    );
    await this.ds.query(`DELETE FROM integration_oauth_states WHERE expires_at <= now()`);

    const callback = this.callbackUrl(input.provider);
    const authorizationUrl = new URL(authEndpoint(input.provider, baseUrl));
    const parameters = authorizationUrl.searchParams;
    parameters.set('client_id', client.clientId);
    parameters.set('state', state);
    if (input.provider !== 'intercom') {
      parameters.set('response_type', 'code');
      parameters.set('redirect_uri', callback);
      if (scopes.length > 0) parameters.set('scope', scopes.join(' '));
    }
    if (input.provider === 'zoho') {
      parameters.set('access_type', 'offline');
      parameters.set('prompt', 'consent');
    }
    if (input.provider === 'salesforce') parameters.set('scope', 'api refresh_token');
    if (input.provider === 'dynamics365') {
      if (baseUrl === null) throw new AppError('validation_failed');
      parameters.set('scope', `${baseUrl}/user_impersonation offline_access`);
    }
    return { authorizationUrl: authorizationUrl.toString() };
  }

  async complete(
    provider: IntegrationProvider,
    state: string,
    code: string,
    callbackParams: URLSearchParams,
  ): Promise<OAuthCompletion> {
    if (state.length < 32 || code.length === 0 || code.length > 4096) {
      throw new AppError('validation_failed');
    }
    const stateHash = createHash('sha256').update(state).digest('hex');
    const rows = await this.ds.query<
      (Pick<IntegrationOAuthStateEntity, 'provider' | 'name' | 'scopes'> & {
        workspaceId: string;
        actorUserId: string;
        baseUrl: string | null;
        returnUrl: string;
        crmContextFields: CrmContextFieldMap | null;
      })[]
    >(
      `DELETE FROM integration_oauth_states
        WHERE state_hash = $1 AND provider = $2 AND expires_at > now()
        RETURNING workspace_id AS "workspaceId", actor_user_id AS "actorUserId",
                  provider, name, base_url AS "baseUrl", scopes, return_url AS "returnUrl",
                  crm_context_fields AS "crmContextFields"`,
      [stateHash, provider],
    );
    const pending = rows[0];
    if (pending === undefined) throw new AppError('unauthorized');
    const client = this.config.crmOAuthClients[provider];
    if (client === undefined || provider === 'freshdesk') throw new AppError('conflict');

    const result = await this.exchange(provider, code, client, pending.baseUrl, callbackParams);
    const credentials: OAuthCompletion['credentials'] = {
      accessToken: result.accessToken,
      authMode: 'bearer',
      ...(result.refreshToken === undefined ? {} : { refreshToken: result.refreshToken }),
      ...(result.tokenExpiresAt === undefined ? {} : { tokenExpiresAt: result.tokenExpiresAt }),
      ...(result.baseUrl === undefined ? {} : { baseUrl: result.baseUrl }),
    };
    return {
      workspaceId: pending.workspaceId,
      actorUserId: pending.actorUserId,
      provider,
      name: pending.name,
      scopes: pending.scopes,
      returnUrl: pending.returnUrl,
      credentials,
      externalAccountId: result.externalAccountId ?? null,
      crmContextFields: pending.crmContextFields,
    };
  }

  async cancel(provider: IntegrationProvider, state: string): Promise<string | null> {
    if (state.length < 32) return null;
    const stateHash = createHash('sha256').update(state).digest('hex');
    const rows = await this.ds.query<{ returnUrl: string }[]>(
      `DELETE FROM integration_oauth_states
        WHERE state_hash = $1 AND provider = $2 AND expires_at > now()
        RETURNING return_url AS "returnUrl"`,
      [stateHash, provider],
    );
    return rows[0]?.returnUrl ?? null;
  }

  async refresh(
    provider: IntegrationProvider,
    credentials: IntegrationCredentials & { refreshToken?: string; tokenExpiresAt?: string },
  ): Promise<IntegrationCredentials & { refreshToken?: string; tokenExpiresAt?: string }> {
    const client = this.config.crmOAuthClients[provider];
    if (client === undefined || credentials.refreshToken === undefined) {
      throw new ConnectorAuthError(`${provider} requires authorization again`, 401);
    }
    if (provider === 'intercom' || provider === 'freshdesk') {
      throw new ConnectorAuthError(`${provider} does not support token refresh`, 401);
    }
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    });
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (provider === 'pipedrive') {
      headers['authorization'] =
        `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`;
    } else {
      form.set('client_id', client.clientId);
      form.set('client_secret', client.clientSecret);
    }
    if (provider === 'dynamics365') {
      if (credentials.baseUrl === undefined) {
        throw new ConnectorAuthError('Dynamics 365 tenant URL is missing', 401);
      }
      form.set('scope', `${credentials.baseUrl}/user_impersonation offline_access`);
    }
    const response = await this.fetcher(
      tokenEndpoint(provider, credentials.baseUrl ?? null, new URLSearchParams()),
      { method: 'POST', headers, body: form.toString() },
      webhookPolicy(this.config),
    );
    const raw = await response.text();
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new ConnectorAuthError(`${provider} rejected the refresh token`, response.status);
    }
    if (!response.ok) {
      throw new AppError('conflict', {
        message: `${provider} token refresh failed with HTTP ${String(response.status)}.`,
      });
    }
    let token: TokenResponse;
    try {
      token = JSON.parse(raw) as TokenResponse;
    } catch {
      throw new AppError('conflict', {
        message: `${provider} returned an invalid refresh response.`,
      });
    }
    const accessToken = token.access_token ?? token.token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new ConnectorAuthError(`${provider} did not return a refreshed access token`, 401);
    }
    const expiresIn = Number(token.expires_in ?? token.expires_in_sec);
    return {
      ...credentials,
      accessToken,
      ...(typeof token.refresh_token === 'string' ? { refreshToken: token.refresh_token } : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0
        ? { tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
      ...(provider === 'salesforce' && typeof token.instance_url === 'string'
        ? { baseUrl: token.instance_url }
        : provider === 'zoho' && typeof token.api_domain === 'string'
          ? { baseUrl: token.api_domain }
          : provider === 'pipedrive' && typeof token.api_domain === 'string'
            ? { baseUrl: token.api_domain }
            : {}),
    };
  }

  callbackUrl(provider: IntegrationProvider): string {
    return new URL(`${CALLBACK_PATH}/${provider}`, this.config.publicUrl).toString();
  }

  private async exchange(
    provider: IntegrationProvider,
    code: string,
    client: { clientId: string; clientSecret: string },
    baseUrl: string | null,
    callbackParams: URLSearchParams,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
    baseUrl?: string;
    externalAccountId?: string;
  }> {
    const redirectUri = this.callbackUrl(provider);
    const tokenUrl = tokenEndpoint(provider, baseUrl, callbackParams);
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (provider === 'pipedrive') {
      headers['authorization'] =
        `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`;
    } else {
      form.set('client_id', client.clientId);
      form.set('client_secret', client.clientSecret);
    }
    if (provider === 'dynamics365') {
      if (baseUrl === null) throw new AppError('validation_failed');
      form.set('scope', `${baseUrl}/user_impersonation offline_access`);
    }
    if (provider === 'intercom') {
      form.delete('redirect_uri');
    }
    const response = await this.fetcher(
      tokenUrl,
      { method: 'POST', headers, body: form.toString() },
      webhookPolicy(this.config),
    );
    const raw = await response.text();
    if (!response.ok) {
      throw new AppError('conflict', {
        message: `The ${provider} OAuth token exchange failed with HTTP ${String(response.status)}.`,
      });
    }
    let token: TokenResponse;
    try {
      token = JSON.parse(raw) as TokenResponse;
    } catch {
      throw new AppError('conflict', {
        message: `${provider} returned an invalid token response.`,
      });
    }
    const accessToken = token.access_token ?? token.token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new AppError('conflict', { message: `${provider} did not return an access token.` });
    }
    const seconds = Number(token.expires_in ?? token.expires_in_sec);
    const tokenExpiresAt =
      Number.isFinite(seconds) && seconds > 0
        ? new Date(Date.now() + seconds * 1000).toISOString()
        : undefined;
    const providerBaseUrl =
      provider === 'salesforce' && typeof token.instance_url === 'string'
        ? token.instance_url
        : provider === 'zoho' && typeof token.api_domain === 'string'
          ? token.api_domain
          : provider === 'pipedrive' && typeof token.api_domain === 'string'
            ? token.api_domain
            : (baseUrl ?? undefined);
    const accountId =
      provider === 'hubspot' && token.hub_id !== undefined
        ? String(token.hub_id)
        : provider === 'pipedrive' && token.company_id !== undefined
          ? String(token.company_id)
          : provider === 'salesforce' && typeof token['id'] === 'string'
            ? token['id'].split('/').filter(Boolean).at(-1)
            : undefined;
    return {
      accessToken,
      ...(typeof token.refresh_token === 'string' ? { refreshToken: token.refresh_token } : {}),
      ...(tokenExpiresAt === undefined ? {} : { tokenExpiresAt }),
      ...(providerBaseUrl === undefined ? {} : { baseUrl: providerBaseUrl }),
      ...(accountId === undefined ? {} : { externalAccountId: accountId }),
    };
  }
}

function authEndpoint(provider: IntegrationProvider, baseUrl: string | null): string {
  switch (provider) {
    case 'hubspot':
      return 'https://app.hubspot.com/oauth/authorize';
    case 'salesforce':
      return isSalesforceSandbox(baseUrl)
        ? 'https://test.salesforce.com/services/oauth2/authorize'
        : 'https://login.salesforce.com/services/oauth2/authorize';
    case 'dynamics365':
      return 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
    case 'zoho':
      return zohoAccountsUrl(baseUrl) + '/oauth/v2/auth';
    case 'pipedrive':
      return 'https://oauth.pipedrive.com/oauth/authorize';
    case 'zendesk':
      return `${requireTenantOrigin(provider, baseUrl)}/oauth/authorizations/new`;
    case 'intercom':
      return intercomAuthUrl(baseUrl);
    case 'freshdesk':
      throw new AppError('conflict', { message: 'Freshdesk uses API-key authentication.' });
  }
}

function tokenEndpoint(
  provider: IntegrationProvider,
  baseUrl: string | null,
  callbackParams: URLSearchParams,
): string {
  switch (provider) {
    case 'hubspot':
      return 'https://api.hubapi.com/oauth/v3/token';
    case 'salesforce':
      return isSalesforceSandbox(baseUrl)
        ? 'https://test.salesforce.com/services/oauth2/token'
        : 'https://login.salesforce.com/services/oauth2/token';
    case 'dynamics365':
      return 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    case 'zoho':
      return zohoAccountsUrl(callbackParams.get('accounts-server') ?? baseUrl) + '/oauth/v2/token';
    case 'pipedrive':
      return 'https://oauth.pipedrive.com/oauth/token';
    case 'zendesk':
      return `${requireTenantOrigin(provider, baseUrl)}/oauth/tokens`;
    case 'intercom':
      return `${intercomApiOrigin(baseUrl)}/auth/eagle/token`;
    case 'freshdesk':
      throw new AppError('conflict', { message: 'Freshdesk uses API-key authentication.' });
  }
}

/** Sandbox orgs log in through test.salesforce.com; decided by exact hostname, not substring. */
function isSalesforceSandbox(baseUrl: string | null): boolean {
  if (baseUrl === null) return false;
  const host = new URL(baseUrl).hostname.toLowerCase();
  return host === 'test.salesforce.com' || host.endsWith('.sandbox.my.salesforce.com');
}

function normalizeScopes(provider: IntegrationProvider, supplied: string[]): string[] {
  if (supplied.length > 0)
    return [...new Set(supplied.map((scope) => scope.trim()).filter(Boolean))];
  switch (provider) {
    case 'hubspot':
      return ['crm.objects.contacts.read', 'crm.objects.contacts.write'];
    case 'salesforce':
      return ['api', 'refresh_token'];
    case 'dynamics365':
      return ['offline_access'];
    case 'zoho':
      return [
        'ZohoCRM.modules.contacts.READ',
        'ZohoCRM.modules.contacts.CREATE',
        'ZohoCRM.modules.contacts.UPDATE',
      ];
    case 'pipedrive':
      return ['contacts:read', 'contacts:full'];
    case 'zendesk':
      return ['users:read', 'users:write'];
    case 'intercom':
      return [];
    case 'freshdesk':
      return [];
  }
}

function validateProviderBaseUrl(provider: IntegrationProvider, raw?: string): string | null {
  const required = ['salesforce', 'dynamics365', 'zoho', 'zendesk'].includes(provider);
  if (raw === undefined || raw.trim() === '') {
    if (required)
      throw new AppError('validation_failed', { message: `${provider} tenant URL is required.` });
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError('validation_failed');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new AppError('validation_failed', { message: 'CRM tenant URL must be an HTTPS origin.' });
  }
  return parsed.origin;
}

function requireTenantOrigin(provider: IntegrationProvider, baseUrl: string | null): string {
  if (baseUrl === null)
    throw new AppError('validation_failed', { message: `${provider} tenant URL is required.` });
  return baseUrl;
}

function zohoAccountsUrl(raw: string | null): string {
  if (raw === null) return 'https://accounts.zoho.com';
  const host = new URL(raw).hostname;
  const suffix = host.endsWith('.eu')
    ? 'eu'
    : host.endsWith('.in')
      ? 'in'
      : host.endsWith('.com.au')
        ? 'com.au'
        : host.endsWith('.jp')
          ? 'jp'
          : host.endsWith('.com.cn')
            ? 'com.cn'
            : 'com';
  return `https://accounts.zoho.${suffix}`;
}

function intercomAuthUrl(baseUrl: string | null): string {
  if (baseUrl === null) return 'https://app.intercom.com/oauth';
  const host = new URL(baseUrl).hostname;
  return host.includes('.eu.') || host.endsWith('.eu')
    ? 'https://app.eu.intercom.com/oauth'
    : host.includes('.au.') || host.endsWith('.au')
      ? 'https://app.au.intercom.com/oauth'
      : 'https://app.intercom.com/oauth';
}

function intercomApiOrigin(baseUrl: string | null): string {
  if (baseUrl === null) return 'https://api.intercom.io';
  const host = new URL(baseUrl).hostname;
  return host.includes('.eu.')
    ? 'https://api.eu.intercom.io'
    : host.includes('.au.')
      ? 'https://api.au.intercom.io'
      : 'https://api.intercom.io';
}

function validateReturnUrl(raw: string, config: AppConfig): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError('validation_failed', { message: 'OAuth return URL is invalid.' });
  }
  const sameOrigin = parsed.origin === config.publicUrl.origin;
  const localDevOrigin =
    config.nodeEnv !== 'production' &&
    parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (!sameOrigin && !localDevOrigin) {
    throw new AppError('validation_failed', {
      message: 'OAuth return URL must belong to this AiLoom instance.',
    });
  }
  return parsed.toString();
}
