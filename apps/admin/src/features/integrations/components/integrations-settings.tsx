// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import {
  INTEGRATION_EVENT_TYPES,
  INTEGRATION_PROVIDERS,
  type IntegrationDto,
  type IntegrationDeliveryDto,
  type IntegrationProvider,
  type IntegrationStatus,
  type WebhookDto,
} from '@app/shared';

import {
  useConnectIntegration,
  useCreateWebhook,
  useDeleteIntegration,
  useDeleteWebhook,
  useIntegrations,
  useIntegrationDeliveries,
  useReplayWebhookDelivery,
  useSetIntegrationStatus,
  useSetWebhookStatus,
  useStartIntegrationOAuth,
  useTestIntegration,
  useTestWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from '../api';

function statusVariant(status: IntegrationStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'active') return 'default';
  if (status === 'error' || status === 'reauth_required') return 'destructive';
  return 'secondary';
}

function providerLabel(provider: IntegrationProvider): string {
  return strings.integrations.providers[provider];
}

export function IntegrationsSettings({ workspaceId }: { workspaceId: string }) {
  const integrations = useIntegrations(workspaceId, true);
  const webhooks = useWebhooks(workspaceId, true);
  if (integrations.isError) return <FormAlert message={errorMessage(integrations.error)} />;
  if (webhooks.isError) return <FormAlert message={errorMessage(webhooks.error)} />;
  if (integrations.isPending || webhooks.isPending) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-8">
      <section aria-labelledby="crm-integrations-title" className="space-y-4">
        <div>
          <h2 id="crm-integrations-title" className="text-lg font-medium">
            {strings.integrations.title}
          </h2>
          <p className="text-sm text-muted-foreground">{strings.integrations.intro}</p>
        </div>
        <ConnectIntegrationForm workspaceId={workspaceId} />
        {integrations.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.integrations.none}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {integrations.data.map((integration) => (
              <IntegrationCard
                key={integration.id}
                workspaceId={workspaceId}
                integration={integration}
              />
            ))}
          </div>
        )}
      </section>
      <WebhooksPanel workspaceId={workspaceId} webhooks={webhooks.data} />
    </div>
  );
}

function ConnectIntegrationForm({ workspaceId }: { workspaceId: string }) {
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
                  {providerLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <aside
            aria-label={strings.integrations.setupGuide}
            className="space-y-4 rounded-md border bg-muted/30 p-4 text-sm md:col-span-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <h3 className="font-medium">
                  {strings.integrations.setupGuide}: {providerLabel(provider)}
                </h3>
                <p className="text-muted-foreground">{strings.integrations.setupGuideIntro}</p>
              </div>
              <a
                className="underline underline-offset-4"
                href={strings.integrations.setupGuides[provider].url}
                rel="noreferrer"
                target="_blank"
              >
                {strings.integrations.setupDocs}
              </a>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="space-y-2 rounded-md border bg-background p-3">
                <h4 className="font-medium">{strings.integrations.requiredAccess}</h4>
                <p className="text-muted-foreground">
                  {strings.integrations.setupGuides[provider].permissions}
                </p>
                <p className="text-xs text-muted-foreground">
                  {strings.integrations.permissionsNote}
                </p>
              </section>
              <section className="space-y-2 rounded-md border bg-background p-3">
                <h4 className="font-medium">{strings.integrations.whatSyncsTitle}</h4>
                <p className="text-muted-foreground">{strings.integrations.whatSyncs}</p>
              </section>
            </div>
            <section className="space-y-2">
              <h4 className="font-medium">{strings.integrations.credentialStepsTitle}</h4>
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                {strings.integrations.setupGuides[provider].steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
            <section className="space-y-2 border-t pt-3">
              <h4 className="font-medium">{strings.integrations.verifyTitle}</h4>
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                {strings.integrations.verifySteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          </aside>
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

function IntegrationCard({
  workspaceId,
  integration,
}: {
  workspaceId: string;
  integration: IntegrationDto;
}) {
  const setStatus = useSetIntegrationStatus(workspaceId);
  const remove = useDeleteIntegration(workspaceId);
  const test = useTestIntegration(workspaceId);
  const deliveries = useIntegrationDeliveries(workspaceId, integration.id);
  const shouldPause = integration.status === 'active';
  const testResult = test.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{integration.name}</CardTitle>
            <CardDescription>{providerLabel(integration.provider)}</CardDescription>
          </div>
          <Badge variant={statusVariant(integration.status)}>
            {strings.integrations.statuses[integration.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{strings.integrations.scopes}</dt>
            <dd>{integration.scopes.length ? integration.scopes.join(', ') : '—'}</dd>
          </div>
        </dl>
        {integration.lastError ? (
          <p className="text-sm text-destructive">{integration.lastError}</p>
        ) : null}
        {testResult ? (
          <p
            className={testResult.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
          >
            {testResult.ok
              ? strings.integrations.testOk
              : strings.integrations.testFailed(testResult.detail ?? '')}
          </p>
        ) : null}
        <section aria-label={strings.integrations.deliveryHistory} className="space-y-2">
          <h3 className="text-sm font-medium">{strings.integrations.deliveryHistory}</h3>
          <p className="text-xs text-muted-foreground">{strings.integrations.deliveryHint}</p>
          {deliveries.isError ? (
            <p className="text-sm text-destructive">{errorMessage(deliveries.error)}</p>
          ) : deliveries.isPending ? (
            <p className="text-sm text-muted-foreground">{strings.app.loading}</p>
          ) : deliveries.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{strings.integrations.noDeliveries}</p>
          ) : (
            <ul className="space-y-2">
              {deliveries.data.map((delivery) => (
                <IntegrationDeliveryRow key={delivery.id} delivery={delivery} />
              ))}
            </ul>
          )}
        </section>
        <p className="text-xs text-muted-foreground">{strings.integrations.testHint}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={test.isPending || integration.status === 'disconnected'}
            onClick={() => {
              test.mutate(integration.id);
            }}
          >
            {test.isPending ? strings.integrations.testing : strings.integrations.test}
          </Button>
          {integration.status !== 'disconnected' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={setStatus.isPending}
              onClick={() => {
                setStatus.mutate({
                  integrationId: integration.id,
                  status: shouldPause ? 'pause' : 'resume',
                });
              }}
            >
              {shouldPause ? strings.integrations.pause : strings.integrations.resume}
            </Button>
          ) : null}
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm">
                {strings.integrations.disconnect}
              </Button>
            }
            title={strings.integrations.disconnectTitle(integration.name)}
            description={strings.integrations.disconnectIntro}
            confirmLabel={strings.integrations.disconnect}
            error={remove.isError ? errorMessage(remove.error) : null}
            pending={remove.isPending}
            onConfirm={(close) => {
              remove.mutate(integration.id, { onSuccess: close });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationDeliveryRow({ delivery }: { delivery: IntegrationDeliveryDto }) {
  const status = strings.integrations.deliveryStatus[delivery.status];
  return (
    <li className="rounded-md border p-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{delivery.eventType}</span>
        <Badge variant={delivery.status === 'failed' ? 'destructive' : 'secondary'}>{status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {new Date(delivery.updatedAt).toLocaleString()} ·{' '}
        {strings.integrations.deliveryDetails(
          delivery.attemptCount,
          delivery.statusCode,
          delivery.durationMs,
        )}
      </p>
      <p className="break-all text-xs text-muted-foreground">
        {strings.integrations.eventReference(delivery.eventId)}
      </p>
      {delivery.externalObjectId && delivery.externalObjectType ? (
        <p className="break-all text-xs text-muted-foreground">
          {strings.integrations.externalObject(
            delivery.externalObjectType,
            delivery.externalObjectId,
          )}
        </p>
      ) : null}
      {delivery.lastError ? <p className="text-xs text-destructive">{delivery.lastError}</p> : null}
    </li>
  );
}

function WebhooksPanel({ workspaceId, webhooks }: { workspaceId: string; webhooks: WebhookDto[] }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['handoff.requested']);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const create = useCreateWebhook(workspaceId);

  return (
    <section aria-labelledby="webhooks-title" className="space-y-4">
      <div>
        <h2 id="webhooks-title" className="text-lg font-medium">
          {strings.webhooks.title}
        </h2>
        <p className="text-sm text-muted-foreground">{strings.webhooks.intro}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{strings.webhooks.add}</CardTitle>
          <CardDescription>{strings.webhooks.addIntro}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(
                { url, events: events as (typeof INTEGRATION_EVENT_TYPES)[number][] },
                {
                  onSuccess: (created) => {
                    setUrl('');
                    setEvents(['handoff.requested']);
                    setNewSecret(created.secret);
                  },
                },
              );
            }}
          >
            <label className="block space-y-1 text-sm">
              <span>{strings.webhooks.url}</span>
              <Input
                type="url"
                required
                placeholder="https://example.com/ailoom"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                }}
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm">{strings.webhooks.events}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {INTEGRATION_EVENT_TYPES.map((eventType) => (
                  <label key={eventType} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={events.includes(eventType)}
                      onChange={(event) => {
                        setEvents((current) =>
                          event.target.checked
                            ? [...current, eventType]
                            : current.filter((item) => item !== eventType),
                        );
                      }}
                    />
                    {eventType}
                  </label>
                ))}
              </div>
            </fieldset>
            <FormAlert message={create.isError ? errorMessage(create.error) : null} />
            <Button type="submit" disabled={create.isPending || events.length === 0}>
              {create.isPending ? strings.webhooks.creating : strings.webhooks.create}
            </Button>
          </form>
          {newSecret ? (
            <div className="warning-panel mt-4 rounded-md border p-3 text-sm">
              <p className="font-medium">{strings.webhooks.secretTitle}</p>
              <code className="break-all">{newSecret}</code>
              <p className="mt-1 text-xs text-muted-foreground">{strings.webhooks.secretHint}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <div className="space-y-4">
        {webhooks.map((webhook) => (
          <WebhookCard key={webhook.id} workspaceId={workspaceId} webhook={webhook} />
        ))}
      </div>
    </section>
  );
}

function WebhookCard({ workspaceId, webhook }: { workspaceId: string; webhook: WebhookDto }) {
  const status = useSetWebhookStatus(workspaceId);
  const remove = useDeleteWebhook(workspaceId);
  const test = useTestWebhook(workspaceId);
  const deliveries = useWebhookDeliveries(workspaceId, webhook.id);
  const replay = useReplayWebhookDelivery(workspaceId, webhook.id);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="break-all text-base">{webhook.url}</CardTitle>
            <CardDescription>{webhook.events.join(', ')}</CardDescription>
          </div>
          <Badge variant={webhook.status === 'active' ? 'default' : 'secondary'}>
            {strings.webhooks.statuses[webhook.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {webhook.lastError ? <p className="text-sm text-destructive">{webhook.lastError}</p> : null}
        {test.data ? (
          <p
            className={test.data.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
          >
            {test.data.ok
              ? strings.webhooks.testOk
              : strings.webhooks.testFailed(test.data.statusCode)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={test.isPending}
            onClick={() => {
              test.mutate(webhook.id);
            }}
          >
            {test.isPending ? strings.webhooks.testing : strings.webhooks.test}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={status.isPending}
            onClick={() => {
              status.mutate({
                webhookId: webhook.id,
                status: webhook.status === 'active' ? 'pause' : 'resume',
              });
            }}
          >
            {webhook.status === 'active' ? strings.webhooks.pause : strings.webhooks.resume}
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm">
                {strings.webhooks.delete}
              </Button>
            }
            title={strings.webhooks.deleteTitle}
            description={strings.webhooks.deleteIntro}
            confirmLabel={strings.webhooks.delete}
            error={remove.isError ? errorMessage(remove.error) : null}
            pending={remove.isPending}
            onConfirm={(close) => {
              remove.mutate(webhook.id, { onSuccess: close });
            }}
          />
        </div>
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium">{strings.webhooks.deliveries}</h3>
          {deliveries.isPending ? <Skeleton className="mt-3 h-10 w-full" /> : null}
          {deliveries.isError ? <FormAlert message={errorMessage(deliveries.error)} /> : null}
          {deliveries.data?.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{strings.webhooks.noDeliveries}</p>
          ) : (
            <div className="mt-2 space-y-2">
              {deliveries.data?.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{delivery.eventType}</span>{' '}
                    <span className="text-muted-foreground">
                      {strings.webhooks.deliveryStatus[delivery.status]} · {delivery.attemptCount}{' '}
                      {strings.webhooks.attempts}
                    </span>
                  </span>
                  {delivery.status === 'failed' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={replay.isPending}
                      onClick={() => {
                        replay.mutate(delivery.id);
                      }}
                    >
                      {strings.webhooks.replay}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
