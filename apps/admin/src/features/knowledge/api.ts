// SPDX-License-Identifier: AGPL-3.0-only
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import {
  type CreateSourceRequest,
  type ErrorCode,
  documentViewSchema,
  type SourceDetailDto,
  type SourceDto,
  type KnowledgeSuggestionQuery,
  type ApproveSuggestionRequest,
  type RejectSuggestionRequest,
  knowledgeSuggestionSchema,
  approveSuggestionResponseSchema,
  sourceDetailSchema,
  sourceDtoSchema,
  type FreshnessQuery,
  documentVersionSchema,
  freshnessItemSchema,
  versionDiffSchema,
} from '@app/shared';

/** Keys match `INVALIDATION_MAP`: a `source.updated` event refetches both. */
const sourcesKey = (workspaceId: string, botId: string) =>
  ['workspaces', workspaceId, 'sources', botId] as const;
const sourceKey = (workspaceId: string, sourceId: string) =>
  ['workspaces', workspaceId, 'source', sourceId] as const;
const documentKey = (workspaceId: string, documentId: string) =>
  ['workspaces', workspaceId, 'document', documentId] as const;
const suggestionsKey = (workspaceId: string, filters: KnowledgeSuggestionQuery) =>
  ['workspaces', workspaceId, 'knowledge-suggestions', filters] as const;

function botPath(workspaceId: string, botId: string): string {
  return `/v1/workspaces/${workspaceId}/bots/${botId}`;
}

export function useSources(workspaceId: string, botId: string) {
  return useQuery({
    queryKey: sourcesKey(workspaceId, botId),
    queryFn: () =>
      api(`${botPath(workspaceId, botId)}/sources`, { schema: z.array(sourceDtoSchema) }),
  });
}

export function useSource(workspaceId: string, botId: string, sourceId: string) {
  return useQuery({
    queryKey: sourceKey(workspaceId, sourceId),
    queryFn: () =>
      api(`${botPath(workspaceId, botId)}/sources/${sourceId}`, { schema: sourceDetailSchema }),
  });
}

export function useDocument(workspaceId: string, botId: string, documentId: string) {
  return useQuery({
    queryKey: documentKey(workspaceId, documentId),
    queryFn: () =>
      api(`${botPath(workspaceId, botId)}/documents/${documentId}`, {
        schema: documentViewSchema,
      }),
  });
}

export function useVersions(workspaceId: string, botId: string, documentId: string) {
  return useQuery({
    queryKey: [...documentKey(workspaceId, documentId), 'versions'],
    queryFn: () =>
      api(`${botPath(workspaceId, botId)}/documents/${documentId}/versions`, {
        schema: z.object({ data: z.array(documentVersionSchema) }),
      }),
  });
}

export function useVersionDiff(
  workspaceId: string,
  botId: string,
  documentId: string,
  fromId: string,
  toId: string,
) {
  return useQuery({
    queryKey: [...documentKey(workspaceId, documentId), 'diff', fromId, toId],
    enabled: fromId !== '' && toId !== '',
    queryFn: () =>
      api(
        `${botPath(workspaceId, botId)}/documents/${documentId}/versions/${fromId}/diff/${toId}`,
        {
          schema: versionDiffSchema,
        },
      ),
  });
}

export function useEditDocument(workspaceId: string, botId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api(`${botPath(workspaceId, botId)}/documents/${documentId}/content`, {
        method: 'PUT',
        body: { content },
        schema: z.object({ changed: z.boolean(), versionId: z.string().nullable() }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: documentKey(workspaceId, documentId) }),
        queryClient.invalidateQueries({
          queryKey: [...documentKey(workspaceId, documentId), 'versions'],
        }),
      ]);
    },
  });
}

const freshnessKey = (workspaceId: string, filters: FreshnessQuery) =>
  ['workspaces', workspaceId, 'knowledge-freshness', filters] as const;

export function useFreshness(workspaceId: string, filters: FreshnessQuery) {
  return useInfiniteQuery({
    queryKey: freshnessKey(workspaceId, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== undefined) params.set(key, String(value));
      if (pageParam !== undefined) params.set('cursor', pageParam);
      return api(`/v1/workspaces/${workspaceId}/knowledge/freshness?${params.toString()}`, {
        schema: z.object({ data: z.array(freshnessItemSchema), nextCursor: z.string().nullable() }),
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

function useInvalidateSource(workspaceId: string, botId: string, sourceId?: string) {
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sourcesKey(workspaceId, botId) }),
      ...(sourceId === undefined
        ? []
        : [queryClient.invalidateQueries({ queryKey: sourceKey(workspaceId, sourceId) })]),
    ]);
  };
}

export function useAddSource(workspaceId: string, botId: string) {
  const invalidate = useInvalidateSource(workspaceId, botId);
  return useMutation({
    mutationFn: (input: CreateSourceRequest) =>
      api(`${botPath(workspaceId, botId)}/sources`, {
        method: 'POST',
        body: input,
        schema: sourceDtoSchema,
      }),
    onSuccess: invalidate,
  });
}

/**
 * A multipart upload through `XMLHttpRequest`, the only browser API that reports upload
 * progress (the shared `api` helper uses `fetch`). Responses are validated with the same DTO.
 */
export function uploadSource(input: {
  workspaceId: string;
  botId: string;
  file: File;
  title?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<SourceDto> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', input.file);
    if (input.title !== undefined) form.append('title', input.title);
    const request = new XMLHttpRequest();
    request.open('POST', `/api${botPath(input.workspaceId, input.botId)}/sources/upload`);
    request.setRequestHeader('X-Requested-With', 'fetch');
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    const failed = (): ApiError =>
      new ApiError({ code: 'internal_error', status: 0, message: '', requestId: '' });
    request.onerror = () => {
      reject(failed());
    };
    request.ontimeout = () => {
      reject(failed());
    };
    request.onabort = () => {
      reject(failed());
    };
    request.onload = () => {
      let body: unknown;
      try {
        const text = request.responseText;
        body = text === '' ? null : JSON.parse(text);
      } catch {
        // A proxy can answer with HTML instead of the API's JSON: treat it as a server error
        // rather than throwing inside `onload` and leaving the mutation pending forever.
        reject(failed());
        return;
      }
      const parsed = sourceDtoSchema.safeParse(body);
      if (request.status >= 200 && request.status < 300 && parsed.success) {
        resolve(parsed.data);
        return;
      }
      reject(
        new ApiError({
          code:
            ((body as { error?: { code?: string } } | null)?.error?.code as
              ErrorCode | undefined) ?? 'internal_error',
          status: request.status,
          message: '',
          requestId: request.getResponseHeader('X-Request-Id') ?? '',
        }),
      );
    };
    input.signal?.addEventListener('abort', () => {
      request.abort();
    });
    request.send(form);
  });
}

export function useUploadSource(workspaceId: string, botId: string) {
  const invalidate = useInvalidateSource(workspaceId, botId);
  return useMutation({
    mutationFn: (input: { file: File; title?: string; onProgress?: (percent: number) => void }) =>
      uploadSource({ workspaceId, botId, ...input }),
    onSuccess: invalidate,
  });
}

export function useResync(workspaceId: string, botId: string, sourceId: string) {
  const invalidate = useInvalidateSource(workspaceId, botId, sourceId);
  return useMutation({
    mutationFn: () =>
      api(`${botPath(workspaceId, botId)}/sources/${sourceId}/resync`, {
        method: 'POST',
        schema: sourceDtoSchema,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateSource(workspaceId: string, botId: string, sourceId: string) {
  const invalidate = useInvalidateSource(workspaceId, botId, sourceId);
  return useMutation({
    mutationFn: (recrawlInterval: '1 day' | '7 days' | '30 days' | null) =>
      api(`${botPath(workspaceId, botId)}/sources/${sourceId}`, {
        method: 'PATCH',
        body: { recrawlInterval },
        schema: sourceDtoSchema,
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteSource(workspaceId: string, botId: string, sourceId: string) {
  const invalidate = useInvalidateSource(workspaceId, botId, sourceId);
  return useMutation({
    mutationFn: () =>
      api(`${botPath(workspaceId, botId)}/sources/${sourceId}`, {
        method: 'DELETE',
        schema: z.void(),
      }),
    onSuccess: invalidate,
  });
}

export function useKnowledgeSuggestions(workspaceId: string, filters: KnowledgeSuggestionQuery) {
  return useQuery({
    queryKey: suggestionsKey(workspaceId, filters),
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) params.set(key, String(value));
      }
      return api(`/v1/workspaces/${workspaceId}/knowledge/suggestions?${params.toString()}`, {
        schema: z.object({
          data: z.array(knowledgeSuggestionSchema),
          nextCursor: z.string().nullable(),
        }),
      });
    },
  });
}

export function useDecideSuggestion(workspaceId: string, suggestionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { action: 'approve'; body: ApproveSuggestionRequest }
        | { action: 'reject'; body: RejectSuggestionRequest },
    ) =>
      api(`/v1/workspaces/${workspaceId}/knowledge/suggestions/${suggestionId}/${input.action}`, {
        method: 'POST',
        body: input.body,
        schema:
          input.action === 'approve'
            ? approveSuggestionResponseSchema
            : z.object({ suggestion: knowledgeSuggestionSchema }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['workspaces', workspaceId, 'knowledge-suggestions'],
      });
    },
  });
}

export type { SourceDetailDto };
