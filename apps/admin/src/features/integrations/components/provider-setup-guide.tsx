// SPDX-License-Identifier: AGPL-3.0-only
import { Badge } from '@/components/ui/badge';
import { strings } from '@/strings';
import { type IntegrationProvider, isBetaIntegrationProvider } from '@app/shared';

import { providerLabel } from './integration-labels';

export function ProviderSetupGuide({ provider }: { provider: IntegrationProvider }) {
  return (
    <aside
      aria-label={strings.integrations.setupGuide}
      className="space-y-4 rounded-md border bg-muted/30 p-4 text-sm md:col-span-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="flex flex-wrap items-center gap-2 font-medium">
            {strings.integrations.setupGuide}: {providerLabel(provider)}
            {isBetaIntegrationProvider(provider) ? (
              <Badge variant="outline">{strings.integrations.beta}</Badge>
            ) : null}
          </h3>
          <p className="text-muted-foreground">{strings.integrations.setupGuideIntro}</p>
          {isBetaIntegrationProvider(provider) ? (
            <p className="text-muted-foreground">{strings.integrations.betaNote}</p>
          ) : null}
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
          <p className="text-xs text-muted-foreground">{strings.integrations.permissionsNote}</p>
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
  );
}
