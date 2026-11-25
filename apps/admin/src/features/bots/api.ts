// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  type BotDto,
  botDtoSchema,
  type CreateBotRequest,
  type CreatePromptVersionRequest,
  promptVersionDtoSchema,
  type UpdateBotRequest,
} from '@app/shared';

const botsKey = (workspaceId: string) => ['workspaces', workspaceId, 'bots'] as const;
const botKey = (workspaceId: string, botId: string) => [...botsKey(workspaceId), botId] as const;
const promptsKey = (workspaceId: string, botId: string) =>
  [...botKey(workspaceId, botId), 'prompt-versions'] as const;

export function useBots(workspaceId: string) {
  return useQuery({
    queryKey: botsKey(workspaceId),
    queryFn: () => api(`/v1/workspaces/${workspaceId}/bots`, { schema: z.array(botDtoSchema) }),
  });
}

export function useBot(workspaceId: string, botId: string) {
  return useQuery({
    queryKey: botKey(workspaceId, botId),
    queryFn: () => api(`/v1/workspaces/${workspaceId}/bots/${botId}`, { schema: botDtoSchema }),
  });
}

export function useCreateBot(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBotRequest) =>
      api(`/v1/workspaces/${workspaceId}/bots`, {
        method: 'POST',
        body: input,
        schema: botDtoSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(workspaceId) }),
  });
}

export function useUpdateBot(workspaceId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBotRequest) =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}`, {
        method: 'PATCH',
        body: input,
        schema: botDtoSchema,
      }),
    onSuccess: (bot: BotDto) => {
      queryClient.setQueryData(botKey(workspaceId, botId), bot);
      return queryClient.invalidateQueries({ queryKey: botsKey(workspaceId) });
    },
  });
}

/** A new key invalidates every site still using the old snippet. */
export function useRotateKey(workspaceId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/rotate-key`, {
        method: 'POST',
        schema: botDtoSchema,
      }),
    onSuccess: (bot: BotDto) => {
      queryClient.setQueryData(botKey(workspaceId, botId), bot);
      // The list shows the public key too, so it must not keep the old one. Written directly:
      // invalidating `botsKey` would also refetch this bot's detail and undo the new key.
      queryClient.setQueryData<BotDto[]>(botsKey(workspaceId), (rows) =>
        rows?.map((row) => (row.id === bot.id ? bot : row)),
      );
    },
  });
}

export function usePromptVersions(workspaceId: string, botId: string) {
  return useQuery({
    queryKey: promptsKey(workspaceId, botId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/prompt-versions`, {
        schema: z.array(promptVersionDtoSchema),
      }),
  });
}

export function useCreatePromptVersion(workspaceId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePromptVersionRequest) =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/prompt-versions`, {
        method: 'POST',
        body: input,
        schema: promptVersionDtoSchema,
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: promptsKey(workspaceId, botId) }),
        queryClient.invalidateQueries({ queryKey: botKey(workspaceId, botId) }),
      ]),
  });
}

export function useActivatePromptVersion(workspaceId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { versionId: string; overrideReason?: string }) =>
      api(
        `/v1/workspaces/${workspaceId}/bots/${botId}/prompt-versions/${vars.versionId}/activate`,
        {
          method: 'POST',
          body: vars.overrideReason === undefined ? {} : { overrideReason: vars.overrideReason },
          schema: promptVersionDtoSchema,
        },
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: promptsKey(workspaceId, botId) }),
        queryClient.invalidateQueries({ queryKey: botKey(workspaceId, botId) }),
      ]),
  });
}
