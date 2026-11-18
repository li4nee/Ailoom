// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import {
  INTEGRATION_EVENT_TYPES,
  integrationEventTypeSchema,
  type IntegrationEventType,
} from '@app/shared';

export { INTEGRATION_EVENT_TYPES, integrationEventTypeSchema };

export const integrationEventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: integrationEventTypeSchema,
  workspaceId: z.uuid(),
  aggregateId: z.uuid(),
  occurredAt: z.iso.datetime(),
  version: z.literal(1),
  data: z.unknown(),
});

export interface IntegrationEventEnvelope {
  id: string;
  type: IntegrationEventType;
  workspaceId: string;
  aggregateId: string;
  occurredAt: string;
  version: 1;
  data: unknown;
}

export interface RecordIntegrationEventInput {
  type: IntegrationEventType;
  aggregateId: string;
  idempotencyKey: string;
  data: unknown;
  occurredAt?: Date;
}
