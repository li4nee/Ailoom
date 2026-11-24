// SPDX-License-Identifier: AGPL-3.0-only
import { strings } from '@/strings';
import { type IntegrationProvider, type IntegrationStatus } from '@app/shared';

export function statusVariant(status: IntegrationStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'active') return 'default';
  if (status === 'error' || status === 'reauth_required') return 'destructive';
  return 'secondary';
}

export function providerLabel(provider: IntegrationProvider): string {
  return strings.integrations.providers[provider];
}
