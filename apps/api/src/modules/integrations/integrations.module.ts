// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { SecretBox } from '../../common/crypto';
import { AuditModule } from '../audit';
import {
  ConnectorRegistry,
  Dynamics365Connector,
  FreshdeskConnector,
  HubSpotConnector,
  IntercomConnector,
  PipedriveConnector,
  SalesforceConnector,
  ZendeskConnector,
  ZohoConnector,
} from './connectors';
import { IntegrationEventProcessor } from './integration-event.processor';
import { IntegrationLinksRepository } from './integration-links.repository';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { OutboxDispatcher } from './outbox-dispatcher';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';
import { WebhookDeliveryProcessor } from './webhooks/webhook-delivery.processor';
import { WebhooksController } from './webhooks/webhooks.controller';
import { WebhookDeliveriesRepository, WebhooksRepository } from './webhooks/webhooks.repository';
import { WebhooksService } from './webhooks/webhooks.service';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [IntegrationsController, WebhooksController],
  providers: [
    IntegrationsRepository,
    IntegrationLinksRepository,
    IntegrationsService,
    OutboxRepository,
    OutboxService,
    OutboxDispatcher,
    IntegrationEventProcessor,
    WebhookDeliveryProcessor,
    WebhooksRepository,
    WebhookDeliveriesRepository,
    WebhooksService,
    Dynamics365Connector,
    FreshdeskConnector,
    HubSpotConnector,
    IntercomConnector,
    PipedriveConnector,
    SalesforceConnector,
    ZendeskConnector,
    ZohoConnector,
    {
      provide: ConnectorRegistry,
      useFactory: (
        dynamics365: Dynamics365Connector,
        freshdesk: FreshdeskConnector,
        hubspot: HubSpotConnector,
        intercom: IntercomConnector,
        pipedrive: PipedriveConnector,
        salesforce: SalesforceConnector,
        zendesk: ZendeskConnector,
        zoho: ZohoConnector,
      ) =>
        new ConnectorRegistry([
          dynamics365,
          freshdesk,
          hubspot,
          intercom,
          pipedrive,
          salesforce,
          zendesk,
          zoho,
        ]),
      inject: [
        Dynamics365Connector,
        FreshdeskConnector,
        HubSpotConnector,
        IntercomConnector,
        PipedriveConnector,
        SalesforceConnector,
        ZendeskConnector,
        ZohoConnector,
      ],
    },
    { provide: Clock, useClass: SystemClock },
    {
      provide: SecretBox,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretBox(config.encryptionKeys),
    },
  ],
  exports: [
    ConnectorRegistry,
    IntegrationsRepository,
    IntegrationLinksRepository,
    IntegrationsService,
    OutboxRepository,
    OutboxService,
    OutboxDispatcher,
    WebhooksService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class IntegrationsModule {}
