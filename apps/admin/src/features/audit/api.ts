// SPDX-License-Identifier: AGPL-3.0-only
import { useInfiniteQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { auditEntrySchema } from '@app/shared';

const auditPageSchema = z.object({
  data: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});

export function useAuditLog(workspaceId: string) {
  return useInfiniteQuery({
    queryKey: ['workspaces', workspaceId, 'audit-log'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api(
        `/v1/workspaces/${workspaceId}/audit-log?limit=50${
          pageParam === null ? '' : `&cursor=${encodeURIComponent(pageParam)}`
        }`,
        { schema: auditPageSchema },
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
}
