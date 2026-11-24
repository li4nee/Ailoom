// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import {
  INTEGRATION_PROVIDERS,
  type CrmContextFieldMap,
  type IntegrationProvider,
  isBetaIntegrationProvider,
} from '@app/shared';

import { useConnectIntegration, useStartIntegrationOAuth } from '../api';
import { providerLabel } from './integration-labels';
import { ProviderSetupGuide } from './provider-setup-guide';

export function ConnectIntegrationForm({ workspaceId }: { workspaceId: string }) {
  const connect = useConnectIntegration(workspaceId);
  const oauth = useStartIntegrationOAuth(workspaceId);
  const [provider, setProvider] = useState<IntegrationProvider>('hubspot');
  const [authMode, setAuthMode] = useState<'bearer' | 'api_key'>('bearer');
  const [authUser, setAuthUser] = useState('');
  const [name, setName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [scopes, setScopes] = useState('');
  const [crmContextFields, setCrmContextFields] = useState({
    summary: '',
    conversationQuality: '',
    leadTemperature: '',
    buyerType: '',
    evidence: '',
  });
  const supportsCrmContext = ['hubspot', 'pipedrive', 'intercom'].includes(provider);
  const crmContextFieldMap: CrmContextFieldMap = {
    ...(crmContextFields.summary.trim() === '' ? {} : { summary: crmContextFields.summary.trim() }),
    ...(crmContextFields.conversationQuality.trim() === ''
      ? {}
      : { conversationQuality: crmContextFields.conversationQuality.trim() }),
    ...(crmContextFields.leadTemperature.trim() === ''
      ? {}
      : { leadTemperature: crmContextFields.leadTemperature.trim() }),
    ...(crmContextFields.buyerType.trim() === ''
      ? {}
      : { buyerType: crmContextFields.buyerType.trim() }),
    ...(crmContextFields.evidence.trim() === ''
      ? {}
      : { evidence: crmContextFields.evidence.trim() }),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{strings.integrations.connectTitle}</CardTitle>
        <CardDescription>{strings.integrations.connectIntro}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            connect.mutate(
              {
                provider,
                name,
                accessToken,
                authMode,
                ...(provider === 'zendesk' && authMode === 'api_key' ? { authUser } : {}),
                ...(externalAccountId.trim()
                  ? { externalAccountId: externalAccountId.trim() }
                  : {}),
                ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
                scopes: scopes
                  .split(',')
                  .map((scope) => scope.trim())
                  .filter((scope) => scope.length > 0),
                settings: { transcriptSharing: false },
                ...(supportsCrmContext && Object.keys(crmContextFieldMap).length > 0
                  ? { crmContextFields: crmContextFieldMap }
                  : {}),
              },
              {
                onSuccess: () => {
                  setName('');
                  setAccessToken('');
                  setAuthMode('bearer');
                  setAuthUser('');
                  setExternalAccountId('');
                  setBaseUrl('');
                  setScopes('');
                  setCrmContextFields({
                    summary: '',
                    conversationQuality: '',
                    leadTemperature: '',
                    buyerType: '',
                    evidence: '',
                  });
                },
              },
            );
          }}
        >
          <label className="space-y-1 text-sm">
            <span>{strings.integrations.provider}</span>
            <select
              aria-label={strings.integrations.provider}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value as IntegrationProvider;
                setProvider(nextProvider);
                setAuthMode(
                  nextProvider === 'freshdesk' || nextProvider === 'pipedrive'
                    ? 'api_key'
                    : 'bearer',
                );
              }}
            >
              {INTEGRATION_PROVIDERS.map((item) => (
                <option key={item} value={item}>
                  {isBetaIntegrationProvider(item)
                    ? strings.integrations.betaOption(providerLabel(item))
                    : providerLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <ProviderSetupGuide provider={provider} />
          <label className="space-y-1 text-sm">
            <span>{strings.integrations.name}</span>
            <Input
              value={name}
              required
              maxLength={100}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>{strings.integrations.accessToken}</span>
            <Input
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={(event) => {
                setAccessToken(event.target.value);
              }}
            />
            <span className="block text-xs text-muted-foreground">
              {strings.integrations.accessTokenHelp}
            </span>
          </label>
          {provider === 'zendesk' || provider === 'freshdesk' || provider === 'pipedrive' ? (
            <label className="space-y-1 text-sm">
              <span>{strings.integrations.authMode}</span>
              <select
                aria-label={strings.integrations.authMode}
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={authMode}
                onChange={(event) => {
                  setAuthMode(event.target.value as 'bearer' | 'api_key');
                }}
              >
                <option value="bearer">{strings.integrations.bearerAuth}</option>
                <option value="api_key">{strings.integrations.apiKeyAuth}</option>
              </select>
            </label>
          ) : null}
          {provider === 'zendesk' && authMode === 'api_key' ? (
            <label className="space-y-1 text-sm">
              <span>{strings.integrations.authUser}</span>
              <Input
                type="email"
                required
                autoComplete="username"
                value={authUser}
                onChange={(event) => {
                  setAuthUser(event.target.value);
                }}
              />
            </label>
          ) : null}
          <label className="space-y-1 text-sm">
            <span>{strings.integrations.externalAccountId}</span>
            <Input
              value={externalAccountId}
              onChange={(event) => {
                setExternalAccountId(event.target.value);
              }}
            />
          </label>
          {['salesforce', 'dynamics365', 'zoho', 'zendesk', 'freshdesk', 'intercom'].includes(
            provider,
          ) ? (
            <label className="space-y-1 text-sm md:col-span-2">
              <span>{strings.integrations.baseUrl}</span>
              <Input
                type="url"
                placeholder="https://your-tenant.example.com"
                required
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                }}
              />
            </label>
          ) : null}
          <label className="space-y-1 text-sm md:col-span-2">
            <span>{strings.integrations.scopes}</span>
            <Input
              placeholder={strings.integrations.scopesHint}
              value={scopes}
              onChange={(event) => {
                setScopes(event.target.value);
              }}
            />
            <span className="block text-xs text-muted-foreground">
              {strings.integrations.setupScopeNote}
            </span>
          </label>
          {supportsCrmContext ? (
            <fieldset className="space-y-3 rounded-md border p-3 md:col-span-2">
              <legend className="px-1 text-sm font-medium">
                {strings.integrations.crmContextTitle}
              </legend>
              <p className="text-xs text-muted-foreground">{strings.integrations.crmContextHelp}</p>
              <p className="text-xs text-muted-foreground">
                {strings.integrations.crmContextProviderHelp(provider)}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {(
                  [
                    ['summary', strings.integrations.crmContextSummary],
                    ['conversationQuality', strings.integrations.crmContextQuality],
                    ['leadTemperature', strings.integrations.crmContextTemperature],
                    ['buyerType', strings.integrations.crmContextBuyerType],
                    ['evidence', strings.integrations.crmContextEvidence],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="space-y-1 text-sm">
                    <span>{label}</span>
                    <Input
                      aria-label={label}
                      value={crmContextFields[key]}
                      onChange={(event) => {
                        setCrmContextFields((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="md:col-span-2">
            <FormAlert message={connect.isError ? errorMessage(connect.error) : null} />
            <FormAlert message={oauth.isError ? errorMessage(oauth.error) : null} />
            <div className="mt-3 flex flex-wrap gap-2">
              {provider !== 'freshdesk' ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={oauth.isPending || name.trim() === ''}
                  onClick={() => {
                    oauth.mutate(
                      {
                        provider,
                        name,
                        ...(baseUrl.trim() === '' ? {} : { baseUrl: baseUrl.trim() }),
                        scopes: scopes
                          .split(',')
                          .map((scope) => scope.trim())
                          .filter((scope) => scope.length > 0),
                        returnUrl: window.location.href,
                        ...(supportsCrmContext && Object.keys(crmContextFieldMap).length > 0
                          ? { crmContextFields: crmContextFieldMap }
                          : {}),
                      },
                      {
                        onSuccess: ({ authorizationUrl }) => {
                          window.location.assign(authorizationUrl);
                        },
                      },
                    );
                  }}
                >
                  {oauth.isPending
                    ? strings.integrations.authorizing
                    : strings.integrations.oauthConnect}
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={connect.isPending || name.trim() === '' || accessToken.trim() === ''}
              >
                {connect.isPending ? strings.integrations.connecting : strings.integrations.connect}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
