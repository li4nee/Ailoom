// SPDX-License-Identifier: AGPL-3.0-only
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import {
  acceptInvitationResponseSchema,
  instancePublicInfoSchema,
  invitationPreviewSchema,
  type LoginRequest,
  meResponseSchema,
  type MeResponse,
  type SignupRequest,
} from '@app/shared';

const okSchema = z.object({ ok: z.literal(true) });

export const meQueryKey = ['me'] as const;

/** The signed-in user, or null when nobody is signed in (never redirects). */
export const meQueryOptions = queryOptions({
  queryKey: meQueryKey,
  queryFn: async (): Promise<MeResponse | null> => {
    try {
      return await api('/v1/auth/me', { schema: meResponseSchema, session: 'optional' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
});

/** Route guards: the cached user, fetched once if nothing is cached yet. */
export function loadMe(queryClient: QueryClient): Promise<MeResponse | null> {
  return queryClient.query({ ...meQueryOptions, staleTime: 'static' });
}

export function useMe() {
  return useQuery(meQueryOptions);
}

export function usePublicInfo() {
  return useQuery({
    queryKey: ['instance', 'public'],
    queryFn: () =>
      api('/v1/instance/public', { schema: instancePublicInfoSchema, session: 'optional' }),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) =>
      api('/v1/auth/login', {
        method: 'POST',
        body: input,
        schema: meResponseSchema,
        session: 'optional',
      }),
    onSuccess: (me) => {
      queryClient.setQueryData(meQueryKey, me);
    },
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: (input: SignupRequest) =>
      api('/v1/auth/signup', {
        method: 'POST',
        body: input,
        schema: z.object({ id: z.string() }),
        session: 'optional',
      }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/v1/auth/logout', { method: 'POST', schema: z.undefined(), session: 'optional' }),
    // Whatever the server said, nothing cached for the old user may outlive the logout.
    onSettled: () => {
      queryClient.clear();
    },
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (token: string) =>
      api('/v1/auth/verify-email', {
        method: 'POST',
        body: { token },
        schema: okSchema,
        session: 'optional',
      }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) =>
      api('/v1/auth/forgot-password', {
        method: 'POST',
        body: { email },
        schema: okSchema,
        session: 'optional',
      }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api('/v1/auth/reset-password', {
        method: 'POST',
        body: input,
        schema: okSchema,
        session: 'optional',
      }),
  });
}

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      api(`/v1/invitations/preview?token=${encodeURIComponent(token)}`, {
        schema: invitationPreviewSchema,
        session: 'optional',
      }),
  });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api('/v1/invitations/accept', {
        method: 'POST',
        body: { token },
        schema: acceptInvitationResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}
