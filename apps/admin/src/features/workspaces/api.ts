// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { meQueryKey } from '@/features/auth/api';
import { api } from '@/lib/api-client';
import {
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  workspaceSchema,
  workspaceSummarySchema,
} from '@app/shared';

export const workspacesKey = ['workspaces'] as const;

export function useWorkspaces() {
  return useQuery({
    queryKey: workspacesKey,
    queryFn: () => api('/v1/workspaces', { schema: z.array(workspaceSummarySchema) }),
  });
}

export function useWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: [...workspacesKey, workspaceId],
    queryFn: () => api(`/v1/workspaces/${workspaceId}`, { schema: workspaceSchema }),
  });
}

/** Membership lists live in `me` and `workspaces`; both change when a workspace does. */
async function refreshWorkspaceLists(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: workspacesKey }),
    queryClient.invalidateQueries({ queryKey: meQueryKey }),
  ]);
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceRequest) =>
      api('/v1/workspaces', { method: 'POST', body: input, schema: workspaceSchema }),
    onSuccess: () => refreshWorkspaceLists(queryClient),
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceRequest) =>
      api(`/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: input,
        schema: workspaceSchema,
      }),
    onSuccess: (workspace) => {
      queryClient.setQueryData([...workspacesKey, workspaceId], workspace);
      return refreshWorkspaceLists(queryClient);
    },
  });
}

export function useDeleteWorkspace(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/v1/workspaces/${workspaceId}`, { method: 'DELETE', schema: z.undefined() }),
    onSuccess: () => refreshWorkspaceLists(queryClient),
  });
}
