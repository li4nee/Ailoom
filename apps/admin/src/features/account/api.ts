// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { meQueryKey } from '@/features/auth/api';
import { api } from '@/lib/api-client';
import { meResponseSchema, sessionSchema, type UpdateMeRequest } from '@app/shared';

const sessionsKey = ['sessions'] as const;

export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => api('/v1/auth/sessions', { schema: z.array(sessionSchema) }),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api(`/v1/auth/sessions/${sessionId}`, { method: 'DELETE', schema: z.undefined() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  });
}

/** Ends every session, this one included; the cache belongs to a signed-out user afterwards. */
export function useLogoutAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/v1/auth/logout-all', { method: 'POST', schema: z.undefined() }),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeRequest) =>
      api('/v1/auth/me', { method: 'PATCH', body: input, schema: meResponseSchema }),
    onSuccess: async (me) => {
      queryClient.setQueryData(meQueryKey, me);
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      api('/v1/auth/me', { method: 'DELETE', body: { password }, schema: z.undefined() }),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
