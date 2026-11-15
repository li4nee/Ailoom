// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { traceDetailSchema } from '@app/shared';

export const traceKey = (workspaceId: string, traceId: string) =>
  ['workspaces', workspaceId, 'trace', traceId] as const;

/** One AI answer's replay, fetched only when the drawer opens. */
export function useTrace(workspaceId: string, traceId: string, enabled = true) {
  return useQuery({
    queryKey: traceKey(workspaceId, traceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/traces/${traceId}`, { schema: traceDetailSchema }),
    enabled,
  });
}
