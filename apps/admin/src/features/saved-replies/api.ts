// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { savedReplySchema, type SavedReply, type SavedReplyWrite } from '@app/shared';

const key = (workspaceId: string) => ['workspaces', workspaceId, 'saved-replies'] as const;

export function useSavedReplies(
  workspaceId: string,
  options: { includeArchived?: boolean; q?: string } = {},
) {
  return useQuery({
    queryKey: [...key(workspaceId), options],
    queryFn: () => {
      const params = new URLSearchParams();
      if (options.includeArchived === true) params.set('includeArchived', 'true');
      if (options.q !== undefined && options.q.trim() !== '') params.set('q', options.q);
      const search = params.toString();
      return api(
        `/v1/workspaces/${workspaceId}/saved-replies${search === '' ? '' : `?${search}`}`,
        {
          schema: z.array(savedReplySchema),
        },
      );
    },
  });
}

export function useCreateSavedReply(workspaceId: string) {
  return useSavedReplyMutation(workspaceId, (input: SavedReplyWrite) =>
    api(`/v1/workspaces/${workspaceId}/saved-replies`, {
      method: 'POST',
      body: input,
      schema: savedReplySchema,
    }),
  );
}

export function useUpdateSavedReply(workspaceId: string) {
  return useSavedReplyMutation(workspaceId, (input: SavedReplyWrite & { id: string }) =>
    api(`/v1/workspaces/${workspaceId}/saved-replies/${input.id}`, {
      method: 'PATCH',
      body: { title: input.title, body: input.body },
      schema: savedReplySchema,
    }),
  );
}

export function useArchiveSavedReply(workspaceId: string) {
  return useSavedReplyMutation(workspaceId, (id: string) =>
    api(`/v1/workspaces/${workspaceId}/saved-replies/${id}`, {
      method: 'DELETE',
      schema: z.undefined(),
    }),
  );
}

export function useReorderSavedReplies(workspaceId: string) {
  return useSavedReplyMutation(workspaceId, (ids: string[]) =>
    api(`/v1/workspaces/${workspaceId}/saved-replies/order`, {
      method: 'PATCH',
      body: { ids },
      schema: z.undefined(),
    }),
  );
}

function useSavedReplyMutation<V>(workspaceId: string, mutationFn: (input: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: key(workspaceId) }),
  });
}

export type { SavedReply };
