// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  botToolDtoSchema,
  mcpDiscoveryResultSchema,
  type CreateBotToolRequest,
  type DiscoverMcpToolsRequest,
} from '@app/shared';

const toolsKey = (workspaceId: string, botId: string) =>
  ['workspaces', workspaceId, 'bots', botId, 'tools'] as const;

export function useBotTools(workspaceId: string, botId: string) {
  return useQuery({
    queryKey: toolsKey(workspaceId, botId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/tools`, {
        schema: z.array(botToolDtoSchema),
      }),
  });
}

export function useSaveBotTool(workspaceId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; definition: CreateBotToolRequest }) =>
      api(
        `/v1/workspaces/${workspaceId}/bots/${botId}/tools${input.id === undefined ? '' : `/${input.id}`}`,
        {
          method: input.id === undefined ? 'POST' : 'PATCH',
          body: input.definition,
          schema: botToolDtoSchema,
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsKey(workspaceId, botId) }),
  });
}

export function useDeleteBotTool(workspaceId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/tools/${toolId}`, {
        method: 'DELETE',
        schema: z.undefined(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsKey(workspaceId, botId) }),
  });
}

export function useTestBotTool(workspaceId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/tools/${toolId}/test`, {
        method: 'POST',
        schema: z.record(z.string(), z.unknown()),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsKey(workspaceId, botId) }),
  });
}

export function useDiscoverMcpTools(workspaceId: string, botId: string) {
  return useMutation({
    mutationFn: (input: DiscoverMcpToolsRequest) =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/tools/mcp/discover`, {
        method: 'POST',
        body: input,
        schema: mcpDiscoveryResultSchema,
      }),
  });
}
