// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { PRIORITIES, ROLES } from './enums.js';

export const AGENT_PRESENCE_STATES = ['online', 'away', 'offline'] as const;
export const AGENT_PRESENCE_LEASE_SECONDS = 300;

const minuteOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid IANA timezone.');

const businessWindowSchema = z
  .object({ start: minuteOfDaySchema, end: minuteOfDaySchema })
  .strict();

export const agentPresenceUpdateSchema = z.object({
  state: z.enum(AGENT_PRESENCE_STATES),
});

export const agentPresenceSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  email: z.email(),
  role: z.enum(ROLES),
  state: z.enum(AGENT_PRESENCE_STATES),
  expiresAt: z.iso.datetime().nullable(),
});

export const weeklyBusinessHoursSchema = z
  .object({
    monday: z.array(businessWindowSchema).max(1),
    tuesday: z.array(businessWindowSchema).max(1),
    wednesday: z.array(businessWindowSchema).max(1),
    thursday: z.array(businessWindowSchema).max(1),
    friday: z.array(businessWindowSchema).max(1),
    saturday: z.array(businessWindowSchema).max(1),
    sunday: z.array(businessWindowSchema).max(1),
  })
  .strict();

const businessHoursDays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const agentOperationsPolicySchema = z
  .object({
    routing: z
      .object({
        enabled: z.boolean(),
        strategy: z.enum(['round_robin', 'least_loaded']),
        maxOpenConversationsPerAgent: z.number().int().min(1).max(100),
        eligibleRoles: z.array(z.enum(ROLES)).min(1).max(3),
        lastAssignedUserId: z.uuid().nullable(),
      })
      .strict()
      .refine((routing) => new Set(routing.eligibleRoles).size === routing.eligibleRoles.length),
    sla: z
      .object({
        timeZone: timeZoneSchema,
        businessHours: weeklyBusinessHoursSchema,
        targets: z
          .record(
            z.enum(PRIORITIES),
            z
              .object({
                firstResponseMinutes: z.number().int().min(1).max(43_200).nullable(),
                resolutionMinutes: z.number().int().min(1).max(43_200).nullable(),
              })
              .strict(),
          )
          .refine((targets) => PRIORITIES.every((priority) => priority in targets)),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ sla }, context) => {
    const intervals = businessHoursDays.flatMap((day, dayIndex) =>
      sla.businessHours[day].map(({ start, end }, rangeIndex) => {
        const startMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
        let endMinute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
        if (startMinute === endMinute) {
          context.addIssue({
            code: 'custom',
            path: ['sla', 'businessHours', day, rangeIndex],
            message: 'Start and end must differ.',
          });
          endMinute += 24 * 60;
        } else if (endMinute < startMinute) {
          endMinute += 24 * 60;
        }
        return { start: dayIndex * 24 * 60 + startMinute, end: dayIndex * 24 * 60 + endMinute };
      }),
    );
    const weekMinutes = 7 * 24 * 60;
    for (const [index, interval] of intervals.entries()) {
      for (const other of intervals.slice(index + 1)) {
        const overlaps = [-weekMinutes, 0, weekMinutes].some((offset) => {
          const otherStart = other.start + offset;
          const otherEnd = other.end + offset;
          return interval.start < otherEnd && otherStart < interval.end;
        });
        if (overlaps) {
          context.addIssue({
            code: 'custom',
            path: ['sla', 'businessHours'],
            message: 'Business-hour ranges may not overlap.',
          });
        }
      }
    }
  });

const noBusinessHours = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
} satisfies z.infer<typeof weeklyBusinessHoursSchema>;

export const DEFAULT_AGENT_OPERATIONS_POLICY: z.infer<typeof agentOperationsPolicySchema> = {
  routing: {
    enabled: false,
    strategy: 'round_robin',
    maxOpenConversationsPerAgent: 10,
    eligibleRoles: ['agent', 'admin', 'owner'],
    lastAssignedUserId: null,
  },
  sla: {
    timeZone: 'UTC',
    businessHours: noBusinessHours,
    targets: {
      low: { firstResponseMinutes: null, resolutionMinutes: null },
      normal: { firstResponseMinutes: null, resolutionMinutes: null },
      high: { firstResponseMinutes: null, resolutionMinutes: null },
      urgent: { firstResponseMinutes: null, resolutionMinutes: null },
    },
  },
};

export const agentOperationsPolicyUpdateSchema = z
  .object({
    routing: z
      .object({
        enabled: z.boolean(),
        strategy: z.enum(['round_robin', 'least_loaded']),
        maxOpenConversationsPerAgent: z.number().int().min(1).max(100),
        eligibleRoles: z
          .array(z.enum(ROLES))
          .min(1)
          .max(3)
          .refine((roles) => new Set(roles).size === roles.length),
      })
      .strict(),
    sla: agentOperationsPolicySchema.shape.sla,
  })
  .strict()
  .superRefine(({ sla }, context) => {
    const intervals = businessHoursDays.flatMap((day, dayIndex) =>
      sla.businessHours[day].map(({ start, end }, rangeIndex) => {
        const startMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
        let endMinute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
        if (startMinute === endMinute) {
          context.addIssue({
            code: 'custom',
            path: ['sla', 'businessHours', day, rangeIndex],
            message: 'Start and end must differ.',
          });
          endMinute += 24 * 60;
        } else if (endMinute < startMinute) {
          endMinute += 24 * 60;
        }
        return { start: dayIndex * 24 * 60 + startMinute, end: dayIndex * 24 * 60 + endMinute };
      }),
    );
    const weekMinutes = 7 * 24 * 60;
    for (const [index, interval] of intervals.entries()) {
      for (const other of intervals.slice(index + 1)) {
        const overlaps = [-weekMinutes, 0, weekMinutes].some((offset) => {
          const otherStart = other.start + offset;
          const otherEnd = other.end + offset;
          return interval.start < otherEnd && otherStart < interval.end;
        });
        if (overlaps) {
          context.addIssue({
            code: 'custom',
            path: ['sla', 'businessHours'],
            message: 'Business-hour ranges may not overlap.',
          });
        }
      }
    }
  });

export const agentOperationsResponseSchema = z.object({
  policy: agentOperationsPolicySchema,
});

export const conversationSlaSchema = z.object({
  firstResponseDueAt: z.iso.datetime().nullable(),
  resolutionDueAt: z.iso.datetime().nullable(),
  firstResponseBreachedAt: z.iso.datetime().nullable(),
  resolutionBreachedAt: z.iso.datetime().nullable(),
});

export type AgentPresenceState = (typeof AGENT_PRESENCE_STATES)[number];
export type AgentPresence = z.infer<typeof agentPresenceSchema>;
export type AgentOperationsPolicy = z.infer<typeof agentOperationsPolicySchema>;
export type AgentOperationsPolicyUpdate = z.infer<typeof agentOperationsPolicyUpdateSchema>;
export type ConversationSla = z.infer<typeof conversationSlaSchema>;
