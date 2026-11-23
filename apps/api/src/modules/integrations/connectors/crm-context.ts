// SPDX-License-Identifier: AGPL-3.0-only
import { crmConversationContextSchema, type CrmContextFieldMap } from '@app/shared';

import type { IntegrationEvent } from './connector';

export function crmContextOnly(event: IntegrationEvent): boolean {
  return (
    typeof event.data === 'object' &&
    event.data !== null &&
    'crmContextOnly' in event.data &&
    event.data.crmContextOnly === true
  );
}

export function mappedCrmContext(
  event: IntegrationEvent,
  mapping: CrmContextFieldMap | null,
): Record<string, string> {
  if (mapping === null || typeof event.data !== 'object' || event.data === null) return {};
  const eventData = event.data as Record<string, unknown>;
  const parsed = crmConversationContextSchema.safeParse(eventData['crmContext']);
  if (!parsed.success) return {};
  const context = parsed.data;
  return {
    ...(mapping.summary === undefined ? {} : { [mapping.summary]: context.summary }),
    ...(mapping.conversationQuality === undefined
      ? {}
      : { [mapping.conversationQuality]: context.conversationQuality }),
    ...(mapping.leadTemperature === undefined
      ? {}
      : { [mapping.leadTemperature]: context.leadTemperature }),
    ...(mapping.buyerType === undefined ? {} : { [mapping.buyerType]: context.buyerType }),
    ...(mapping.evidence === undefined ? {} : { [mapping.evidence]: context.evidence }),
  };
}
