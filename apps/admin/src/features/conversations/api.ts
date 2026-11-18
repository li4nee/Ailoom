// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  type AdminMessage,
  type ConversationAiArtifact,
  conversationAiArtifactSchema,
  adminMessageSchema,
  type ConversationCounts,
  conversationCountsSchema,
  type ConversationDetail,
  type ConversationListItem,
  conversationDetailSchema,
  conversationListItemSchema,
  conversationPriorityResponseSchema,
  conversationAssignmentResponseSchema,
  conversationStatusResponseSchema,
} from '@app/shared';

export interface InboxFilters {
  botId?: string | undefined;
  status?: string | undefined;
  assignedTo?: string | undefined;
  priority?: string | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

const conversationsKey = (workspaceId: string, filters: InboxFilters) =>
  ['workspaces', workspaceId, 'conversations', filters] as const;
const countsKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'conversations', 'counts'] as const;
const conversationKey = (workspaceId: string, conversationId: string) =>
  ['workspaces', workspaceId, 'conversation', conversationId] as const;

function queryString(filters: InboxFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

function path(workspaceId: string, conversationId: string, action?: string): string {
  return `/v1/workspaces/${workspaceId}/conversations/${conversationId}${action === undefined ? '' : `/${action}`}`;
}

export function useConversations(workspaceId: string, filters: InboxFilters) {
  return useQuery({
    queryKey: conversationsKey(workspaceId, filters),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/conversations${queryString(filters)}`, {
        schema: z.object({
          data: z.array(conversationListItemSchema),
          nextCursor: z.string().nullable(),
        }),
      }),
  });
}

export function useConversationCounts(workspaceId: string) {
  return useQuery({
    queryKey: countsKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/conversations/counts`, {
        schema: conversationCountsSchema,
      }),
  });
}
export function fetchConversation(
  workspaceId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  return api(path(workspaceId, conversationId), { schema: conversationDetailSchema });
}

export function useConversation(workspaceId: string, conversationId: string) {
  return useQuery({
    queryKey: conversationKey(workspaceId, conversationId),
    queryFn: () => fetchConversation(workspaceId, conversationId),
    refetchInterval: (query) => {
      const state = query.state.data?.handoffSummary?.state;
      return state === 'queued' || state === 'running' ? 1500 : false;
    },
  });
}

export function useRegenerateHandoffSummary(workspaceId: string, conversationId: string) {
  const invalidate = useInvalidateConversation(workspaceId, conversationId);
  return useMutation({
    mutationFn: () =>
      api(`${path(workspaceId, conversationId)}/agent-assist/handoff-summary`, {
        method: 'POST',
        schema: conversationAiArtifactSchema,
      }),
    onSuccess: invalidate,
  });
}

function useInvalidateConversation(workspaceId: string, conversationId: string) {
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, conversationId) }),
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'conversations'] }),
    ]);
  };
}

export function useSendAgentMessage(workspaceId: string, conversationId: string) {
  const invalidate = useInvalidateConversation(workspaceId, conversationId);
  return useMutation({
    mutationFn: (content: string) =>
      api(path(workspaceId, conversationId, 'messages'), {
        method: 'POST',
        body: { content },
        schema: adminMessageSchema,
      }),
    onSuccess: invalidate,
  });
}

function useStatusAction(
  workspaceId: string,
  conversationId: string,
  action: 'takeover' | 'handback' | 'close',
) {
  const invalidate = useInvalidateConversation(workspaceId, conversationId);
  return useMutation({
    mutationFn: () =>
      api(path(workspaceId, conversationId, action), {
        method: 'POST',
        schema: conversationStatusResponseSchema,
      }),
    onSuccess: invalidate,
  });
}

export function useTakeover(workspaceId: string, conversationId: string) {
  return useStatusAction(workspaceId, conversationId, 'takeover');
}

export function useHandback(workspaceId: string, conversationId: string) {
  return useStatusAction(workspaceId, conversationId, 'handback');
}

export function useClose(workspaceId: string, conversationId: string) {
  return useStatusAction(workspaceId, conversationId, 'close');
}

export function useSetConversationPriority(workspaceId: string, conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      priority: string;
      expectedWorkflowVersion: number;
      mutationId: string;
    }) =>
      api(path(workspaceId, conversationId, 'priority'), {
        method: 'PATCH',
        body: input,
        schema: conversationPriorityResponseSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, conversationId) }),
        queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'conversations'] }),
      ]);
    },
  });
}

export function useSetConversationAssignment(workspaceId: string, conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assignedUserId: string | null;
      expectedWorkflowVersion: number;
      mutationId: string;
    }) =>
      api(path(workspaceId, conversationId, 'assignment'), {
        method: 'PATCH',
        body: input,
        schema: conversationAssignmentResponseSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, conversationId) }),
        queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'conversations'] }),
      ]);
    },
  });
}

export type {
  AdminMessage,
  ConversationAiArtifact,
  ConversationCounts,
  ConversationDetail,
  ConversationListItem,
};
