// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import {
  diagnosticsSchema,
  instanceSettingsSchema,
  type UpdateInstanceSettingsRequest,
} from '@app/shared';

const instanceKey = ['instance', 'settings'] as const;
const diagnosticsKey = ['instance', 'diagnostics'] as const;

export function useInstanceSettings(enabled: boolean) {
  return useQuery({
    queryKey: instanceKey,
    queryFn: () => api('/v1/instance/settings', { schema: instanceSettingsSchema }),
    enabled,
  });
}

export function useDiagnostics(enabled: boolean) {
  return useQuery({
    queryKey: diagnosticsKey,
    queryFn: () => api('/health/diagnostics', { schema: diagnosticsSchema }),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useUpdateInstanceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInstanceSettingsRequest) =>
      api('/v1/instance/settings', { method: 'PUT', body: input, schema: instanceSettingsSchema }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(instanceKey, settings);
      await queryClient.invalidateQueries({ queryKey: ['instance', 'public'] });
    },
  });
}
