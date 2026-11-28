// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_OPERATIONS_POLICY } from '@app/shared';

import { addBusinessMinutes } from './agent-operations.sla';

describe('addBusinessMinutes', () => {
  it('uses elapsed time when business hours are not configured', () => {
    const deadline = addBusinessMinutes(
      new Date('2026-03-02T10:00:00.000Z'),
      90,
      'UTC',
      DEFAULT_AGENT_OPERATIONS_POLICY.sla.businessHours,
    );

    expect(deadline?.toISOString()).toBe('2026-03-02T11:30:00.000Z');
  });

  it('pauses outside configured hours and resumes at the next open interval', () => {
    const businessHours = {
      ...DEFAULT_AGENT_OPERATIONS_POLICY.sla.businessHours,
      monday: [{ start: '09:00', end: '17:00' }],
      tuesday: [{ start: '09:00', end: '17:00' }],
    };
    const deadline = addBusinessMinutes(
      new Date('2026-03-02T16:00:00.000Z'),
      120,
      'UTC',
      businessHours,
    );

    expect(deadline?.toISOString()).toBe('2026-03-03T10:00:00.000Z');
  });

  it('counts the continuation of an overnight schedule on the next local day', () => {
    const businessHours = {
      ...DEFAULT_AGENT_OPERATIONS_POLICY.sla.businessHours,
      monday: [{ start: '22:00', end: '02:00' }],
    };
    const deadline = addBusinessMinutes(
      new Date('2026-03-03T05:30:00.000Z'),
      90,
      'America/New_York',
      businessHours,
    );

    expect(deadline?.toISOString()).toBe('2026-03-03T07:00:00.000Z');
  });

  it('uses elapsed UTC minutes across a daylight-saving transition', () => {
    const businessHours = {
      ...DEFAULT_AGENT_OPERATIONS_POLICY.sla.businessHours,
      sunday: [{ start: '00:00', end: '04:00' }],
    };
    const deadline = addBusinessMinutes(
      new Date('2026-03-08T05:00:00.000Z'),
      180,
      'America/New_York',
      businessHours,
    );

    expect(deadline?.toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });
});
