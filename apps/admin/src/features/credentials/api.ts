// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  type CreateCredentialRequest,
  type CredentialModel,
  type CredentialTestResult,
  credentialDtoSchema,
  credentialModelSchema,
  credentialTestResultSchema,
  type UpdateCredentialRequest,
} from '@app/shared';

const credentialsKey = (workspaceId: string) => ['workspaces', workspaceId, 'credentials'] as const;

/** Admin-only on the API (spec §17.4), so callers pass `enabled: false` for agents. */
export function useCredentials(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: credentialsKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/credentials`, { schema: z.array(credentialDtoSchema) }),
    enabled,
  });
}

/** The models a credential can reach. A provider call, so it is fetched on demand only. */
export function useModels(workspaceId: string, credentialId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...credentialsKey(workspaceId), credentialId, 'models'] as const,
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/credentials/${credentialId}/models`, {
        schema: z.array(credentialModelSchema),
      }),
    enabled,
  });
}

function useCredentialMutation<V>(workspaceId: string, run: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: credentialsKey(workspaceId) }),
  });
}

export function useCreateCredential(workspaceId: string) {
  return useCredentialMutation(workspaceId, (input: CreateCredentialRequest) =>
    api(`/v1/workspaces/${workspaceId}/credentials`, {
      method: 'POST',
      body: input,
      schema: credentialDtoSchema,
    }),
  );
}

export function useUpdateCredential(workspaceId: string) {
  return useCredentialMutation(
    workspaceId,
    (vars: { credentialId: string; input: UpdateCredentialRequest }) =>
      api(`/v1/workspaces/${workspaceId}/credentials/${vars.credentialId}`, {
        method: 'PATCH',
        body: vars.input,
        schema: credentialDtoSchema,
      }),
  );
}

export function useDeleteCredential(workspaceId: string) {
  return useCredentialMutation(workspaceId, (credentialId: string) =>
    api(`/v1/workspaces/${workspaceId}/credentials/${credentialId}`, {
      method: 'DELETE',
      schema: z.undefined(),
    }),
  );
}

/** A test never fails the mutation: a failed probe is a result (`ok: false`). */
export function useTestCredential(workspaceId: string) {
  return useMutation({
    mutationFn: (credentialId: string): Promise<CredentialTestResult> =>
      api(`/v1/workspaces/${workspaceId}/credentials/${credentialId}/test`, {
        method: 'POST',
        schema: credentialTestResultSchema,
      }),
  });
}

export type { CredentialModel };
