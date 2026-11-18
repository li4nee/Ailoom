// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  type ConnectIntegrationRequest,
  type CreateWebhookRequest,
  type CreatedWebhook,
  createdWebhookSchema,
  integrationSchema,
  webhookDeliverySchema,
  webhookSchema,
} from '@app/shared';

export const integrationsKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'integrations'] as const;
export const webhooksKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'webhooks'] as const;

export function useIntegrations(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: integrationsKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/integrations`, { schema: z.array(integrationSchema) }),
    enabled,
  });
}

function useIntegrationMutation<V, R>(workspaceId: string, run: (value: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationsKey(workspaceId) }),
  });
}

export function useConnectIntegration(workspaceId: string) {
  return useIntegrationMutation(workspaceId, (input: ConnectIntegrationRequest) =>
    api(`/v1/workspaces/${workspaceId}/integrations`, {
      method: 'POST',
      body: input,
      schema: integrationSchema,
    }),
  );
}

export function useSetIntegrationStatus(workspaceId: string) {
  return useIntegrationMutation(
    workspaceId,
    (value: { integrationId: string; status: 'pause' | 'resume' }) =>
      api(`/v1/workspaces/${workspaceId}/integrations/${value.integrationId}/${value.status}`, {
        method: 'POST',
        schema: integrationSchema,
      }),
  );
}

export function useDeleteIntegration(workspaceId: string) {
  return useIntegrationMutation(workspaceId, (integrationId: string) =>
    api(`/v1/workspaces/${workspaceId}/integrations/${integrationId}`, {
      method: 'DELETE',
      schema: z.undefined(),
    }),
  );
}

export function useTestIntegration(workspaceId: string) {
  return useMutation({
    mutationFn: (integrationId: string) =>
      api(`/v1/workspaces/${workspaceId}/integrations/${integrationId}/test`, {
        method: 'POST',
        schema: z.object({
          ok: z.boolean(),
          provider: z.string(),
          externalAccountId: z.string().nullable(),
          detail: z.string().optional(),
        }),
      }),
  });
}

export function useWebhooks(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: webhooksKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/webhooks`, { schema: z.array(webhookSchema) }),
    enabled,
  });
}

function useWebhookMutation<V, R>(workspaceId: string, run: (value: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhooksKey(workspaceId) }),
  });
}

export function useCreateWebhook(workspaceId: string) {
  return useWebhookMutation<CreateWebhookRequest, CreatedWebhook>(workspaceId, (input) =>
    api(`/v1/workspaces/${workspaceId}/webhooks`, {
      method: 'POST',
      body: input,
      schema: createdWebhookSchema,
    }),
  );
}

export function useSetWebhookStatus(workspaceId: string) {
  return useWebhookMutation(
    workspaceId,
    (value: { webhookId: string; status: 'pause' | 'resume' }) =>
      api(`/v1/workspaces/${workspaceId}/webhooks/${value.webhookId}/${value.status}`, {
        method: 'POST',
        schema: webhookSchema,
      }),
  );
}

export function useDeleteWebhook(workspaceId: string) {
  return useWebhookMutation(workspaceId, (webhookId: string) =>
    api(`/v1/workspaces/${workspaceId}/webhooks/${webhookId}`, {
      method: 'DELETE',
      schema: z.undefined(),
    }),
  );
}

export function useTestWebhook(workspaceId: string) {
  return useMutation({
    mutationFn: (webhookId: string) =>
      api(`/v1/workspaces/${workspaceId}/webhooks/${webhookId}/test`, {
        method: 'POST',
        schema: z.object({ ok: z.boolean(), statusCode: z.number().int() }),
      }),
  });
}

export function useWebhookDeliveries(workspaceId: string, webhookId: string) {
  return useQuery({
    queryKey: [...webhooksKey(workspaceId), webhookId, 'deliveries'] as const,
    queryFn: () =>
      api(`/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries`, {
        schema: z.array(webhookDeliverySchema),
      }),
  });
}

export function useReplayWebhookDelivery(workspaceId: string, webhookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) =>
      api(`/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries/${deliveryId}/replay`, {
        method: 'POST',
        schema: z.undefined(),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...webhooksKey(workspaceId), webhookId, 'deliveries'],
      }),
  });
}
