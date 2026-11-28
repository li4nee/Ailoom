// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_OPERATIONS_POLICY,
  agentOperationsPolicySchema,
  agentOperationsPolicyUpdateSchema,
} from './agent-operations.js';

describe('agent operations policy', () => {
  it('provides conservative defaults with routing and SLA targets disabled', () => {
    expect(agentOperationsPolicySchema.safeParse(DEFAULT_AGENT_OPERATIONS_POLICY).success).toBe(
      true,
    );
    expect(DEFAULT_AGENT_OPERATIONS_POLICY.routing.enabled).toBe(false);
    expect(
      Object.values(DEFAULT_AGENT_OPERATIONS_POLICY.sla.targets).every(
        (target) => target.firstResponseMinutes === null && target.resolutionMinutes === null,
      ),
    ).toBe(true);
  });

  it('rejects invalid timezones, overlapping overnight windows, and model-added fields', () => {
    const invalidTimezone = structuredClone(DEFAULT_AGENT_OPERATIONS_POLICY);
    invalidTimezone.sla.timeZone = 'not/a-timezone';
    expect(agentOperationsPolicySchema.safeParse(invalidTimezone).success).toBe(false);

    const overlappingHours = structuredClone(DEFAULT_AGENT_OPERATIONS_POLICY);
    overlappingHours.sla.businessHours.monday = [{ start: '22:00', end: '02:00' }];
    overlappingHours.sla.businessHours.tuesday = [{ start: '01:00', end: '03:00' }];
    expect(agentOperationsPolicySchema.safeParse(overlappingHours).success).toBe(false);
    expect(
      agentOperationsPolicyUpdateSchema.safeParse({
        routing: {
          enabled: false,
          strategy: 'round_robin',
          maxOpenConversationsPerAgent: 10,
          eligibleRoles: ['agent', 'admin', 'owner'],
        },
        sla: overlappingHours.sla,
      }).success,
    ).toBe(false);

    const unknownAction = {
      ...DEFAULT_AGENT_OPERATIONS_POLICY,
      routeAction: 'delete_customer',
    };
    expect(agentOperationsPolicySchema.safeParse(unknownAction).success).toBe(false);
  });

  it('keeps the internal round-robin cursor out of admin updates', () => {
    const { enabled, strategy, maxOpenConversationsPerAgent, eligibleRoles } =
      DEFAULT_AGENT_OPERATIONS_POLICY.routing;
    const routing = { enabled, strategy, maxOpenConversationsPerAgent, eligibleRoles };
    expect(
      agentOperationsPolicyUpdateSchema.safeParse({
        ...DEFAULT_AGENT_OPERATIONS_POLICY,
        routing,
      }).success,
    ).toBe(true);
  });
});
