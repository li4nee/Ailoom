// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useIntegrations, useWebhooks } from '../api';
import { ConnectIntegrationForm } from './connect-integration-form';
import { IntegrationCard } from './integration-card';
import { WebhooksSection } from './webhooks-section';

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
      <WebhooksSection workspaceId={workspaceId} webhooks={webhooks.data} />
    </div>
  );
}
