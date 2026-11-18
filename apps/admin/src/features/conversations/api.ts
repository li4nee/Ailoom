// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  type AdminMessage,
  type ConversationAiArtifact,
  conversationAiArtifactSchema,
  suggestedReplyArtifactSchema,
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
  type InternalNote,
  internalNoteSchema,
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

export function useSuggestReply(workspaceId: string, conversationId: string) {
  return useMutation({
    mutationFn: () =>
      api(`${path(workspaceId, conversationId)}/agent-assist/suggested-reply`, {
        method: 'POST',
        body: { idempotencyKey: crypto.randomUUID() },
        schema: suggestedReplyArtifactSchema,
      }),
  });
}

const internalNotesKey = (workspaceId: string, conversationId: string) =>
  ['workspaces', workspaceId, 'internal-notes', conversationId] as const;

export function useInternalNotes(workspaceId: string, conversationId: string) {
  return useQuery({
    queryKey: internalNotesKey(workspaceId, conversationId),
    queryFn: () =>
      api(`${path(workspaceId, conversationId)}/internal-notes`, {
        schema: z.array(internalNoteSchema),
      }),
  });
}

function useNoteMutation<TInput>(
  workspaceId: string,
  conversationId: string,
  mutationFn: (input: TInput) => Promise<InternalNote>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: internalNotesKey(workspaceId, conversationId),
      });
    },
  });
}

export function useCreateInternalNote(workspaceId: string, conversationId: string) {
  return useNoteMutation(workspaceId, conversationId, (input: { body: string }) =>
    api(`${path(workspaceId, conversationId)}/internal-notes`, {
      method: 'POST',
      body: input,
      schema: internalNoteSchema,
    }),
  );
}

export function useUpdateInternalNote(workspaceId: string, conversationId: string) {
  return useNoteMutation(
    workspaceId,
    conversationId,
    ({ noteId, ...input }: { noteId: string; body: string; expectedVersion: number }) =>
      api(`${path(workspaceId, conversationId)}/internal-notes/${noteId}`, {
        method: 'PATCH',
        body: input,
        schema: internalNoteSchema,
      }),
  );
}

export function useDeleteInternalNote(workspaceId: string, conversationId: string) {
  return useNoteMutation(
    workspaceId,
    conversationId,
    ({ noteId, ...input }: { noteId: string; expectedVersion: number }) =>
      api(`${path(workspaceId, conversationId)}/internal-notes/${noteId}`, {
        method: 'DELETE',
        body: input,
        schema: internalNoteSchema,
      }),
  );
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
