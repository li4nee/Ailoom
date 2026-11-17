// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { SecretBox } from '../../common/crypto';
import { AuditModule } from '../audit';
import { ConnectorRegistry } from './connectors/connector-registry';
import { IntegrationEventProcessor } from './integration-event.processor';
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
    IntegrationsService,
    OutboxRepository,
    OutboxService,
    OutboxDispatcher,
    IntegrationEventProcessor,
    WebhookDeliveryProcessor,
    WebhooksRepository,
    WebhookDeliveriesRepository,
    WebhooksService,
    ConnectorRegistry,
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
    IntegrationsService,
    OutboxRepository,
    OutboxService,
    OutboxDispatcher,
    WebhooksService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class IntegrationsModule {}
