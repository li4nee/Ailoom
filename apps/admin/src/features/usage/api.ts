// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  feedbackItemSchema,
  type UsageReport,
  usageReportSchema,
  unansweredItemSchema,
} from '@app/shared';

export interface UsageRange {
  from: string;
  to: string;
  botId?: string;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export function defaultUsageRange(now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = `${to.slice(0, 7)}-01`;
  return { from, to };
}

export function useUsage(workspaceId: string, range: UsageRange) {
  return useQuery({
    queryKey: ['workspaces', workspaceId, 'usage', range],
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/usage${query({ ...range })}`, {
        schema: usageReportSchema,
      }),
  });
}

export function useUnanswered(
  workspaceId: string,
  filters: { botId?: string; cursor?: string; limit?: number },
) {
  return useQuery({
    queryKey: ['workspaces', workspaceId, 'unanswered', filters],
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/unanswered${query({ ...filters })}`, {
        schema: z.object({
          data: z.array(unansweredItemSchema),
          nextCursor: z.string().nullable(),
        }),
      }),
  });
}

export function useFeedback(
  workspaceId: string,
  filters: { botId?: string; rating?: '-1' | '1'; cursor?: string; limit?: number },
) {
  return useQuery({
    queryKey: ['workspaces', workspaceId, 'feedback', filters],
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/feedback${query({ ...filters })}`, {
        schema: z.object({
          data: z.array(feedbackItemSchema),
          nextCursor: z.string().nullable(),
        }),
      }),
  });
}

export function positiveRate(report: UsageReport): string | null {
  const rate = report.feedback.positiveRate;
  return rate === null ? null : `${(rate * 100).toFixed(1)}%`;
}

export function escalationRate(report: UsageReport): string {
  if (report.totals.visitorMessages === 0) return '—';
  return `${((report.totals.escalations / report.totals.visitorMessages) * 100).toFixed(1)}%`;
}
