// SPDX-License-Identifier: AGPL-3.0-only
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import {
  type IntegrationDeliveryDto,
  type IntegrationDto,
  isBetaIntegrationProvider,
} from '@app/shared';

import {
  useDeleteIntegration,
  useIntegrationDeliveries,
  useSetIntegrationStatus,
  useTestIntegration,
} from '../api';
import { providerLabel, statusVariant } from './integration-labels';

export function IntegrationCard({
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
          <div className="flex flex-wrap justify-end gap-2">
            {isBetaIntegrationProvider(integration.provider) ? (
              <Badge variant="outline">{strings.integrations.beta}</Badge>
            ) : null}
            <Badge variant={statusVariant(integration.status)}>
              {strings.integrations.statuses[integration.status]}
            </Badge>
          </div>
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

export function IntegrationDeliveryRow({ delivery }: { delivery: IntegrationDeliveryDto }) {
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
