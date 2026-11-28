// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  agentOperationsPolicySchema,
  agentPresenceSchema,
  agentPresenceUpdateSchema,
  type AgentOperationsPolicyUpdate,
  type AgentPresenceState,
} from '@app/shared';

const policyKey = (workspaceId: string) => ['workspaces', workspaceId, 'agent-operations'] as const;
const presenceKey = (workspaceId: string) => ['workspaces', workspaceId, 'agent-presence'] as const;

export function useAgentOperationsPolicy(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: policyKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/agent-operations`, {
        schema: agentOperationsPolicySchema,
      }),
    enabled,
  });
}

export function useUpdateAgentOperationsPolicy(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentOperationsPolicyUpdate) =>
      api(`/v1/workspaces/${workspaceId}/agent-operations`, {
        method: 'PUT',
        body: input,
        schema: agentOperationsPolicySchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: policyKey(workspaceId) }),
  });
}

export function useAgentPresence(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: presenceKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/agent-operations/presence`, {
        schema: z.array(agentPresenceSchema),
      }),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useSetAgentPresence(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (state: AgentPresenceState) =>
      api(`/v1/workspaces/${workspaceId}/agent-operations/presence`, {
        method: 'PUT',
        body: agentPresenceUpdateSchema.parse({ state }),
        schema: agentPresenceSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: presenceKey(workspaceId) }),
  });
}

export function useHeartbeatAgentPresence(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/v1/workspaces/${workspaceId}/agent-operations/presence/heartbeat`, {
        method: 'POST',
        schema: agentPresenceSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: presenceKey(workspaceId) }),
  });
}
