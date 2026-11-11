// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialDto } from '@app/shared';

import type { ProviderCredentialEntity } from './provider-credential.entity';

/**
 * The only mapping from a credential row to a response. The entity's secret columns have no
 * counterpart here on purpose: no DTO can carry the ciphertext or the decrypted key.
 */
export function toCredentialDto(credential: ProviderCredentialEntity): CredentialDto {
  return {
    id: credential.id,
    provider: credential.provider,
    label: credential.label,
    secretLast4: credential.secretLast4,
    baseUrl: credential.baseUrl,
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    lastErrorAt: credential.lastErrorAt?.toISOString() ?? null,
    lastError: credential.lastError,
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
  };
}
