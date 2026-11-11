// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { meQueryKey } from '@/features/auth/api';
import { api } from '@/lib/api-client';
import {
  type CreateInvitationRequest,
  createdInvitationSchema,
  type InvitationRole,
  invitationSchema,
  memberSchema,
} from '@app/shared';

const membersKey = (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const;
const invitationsKey = (workspaceId: string) => ['workspaces', workspaceId, 'invitations'] as const;

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: membersKey(workspaceId),
    queryFn: () => api(`/v1/workspaces/${workspaceId}/members`, { schema: z.array(memberSchema) }),
  });
}

function useMemberMutation<V>(workspaceId: string, run: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: membersKey(workspaceId) }),
        // My own role may have changed (ownership transfer, leaving).
        queryClient.invalidateQueries({ queryKey: meQueryKey }),
      ]),
  });
}

export function useChangeRole(workspaceId: string) {
  return useMemberMutation(workspaceId, (vars: { userId: string; role: InvitationRole }) =>
    api(`/v1/workspaces/${workspaceId}/members/${vars.userId}`, {
      method: 'PATCH',
      body: { role: vars.role },
      schema: memberSchema,
    }),
  );
}

export function useRemoveMember(workspaceId: string) {
  return useMemberMutation(workspaceId, (userId: string) =>
    api(`/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
      schema: z.undefined(),
    }),
  );
}

export function useTransferOwnership(workspaceId: string) {
  return useMemberMutation(workspaceId, (userId: string) =>
    api(`/v1/workspaces/${workspaceId}/transfer-ownership`, {
      method: 'POST',
      body: { userId },
      schema: z.undefined(),
    }),
  );
}

export function useInvitations(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: invitationsKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/invitations`, { schema: z.array(invitationSchema) }),
    enabled,
  });
}

export function useCreateInvitation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationRequest) =>
      api(`/v1/workspaces/${workspaceId}/invitations`, {
        method: 'POST',
        body: input,
        schema: createdInvitationSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsKey(workspaceId) }),
  });
}

export function useRevokeInvitation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      api(`/v1/workspaces/${workspaceId}/invitations/${invitationId}`, {
        method: 'DELETE',
        schema: z.undefined(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsKey(workspaceId) }),
  });
}
