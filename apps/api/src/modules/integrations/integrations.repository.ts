// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { IntegrationProvider, IntegrationStatus } from '@app/shared';

import type { Sealed } from '../../common/crypto';
import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { IntegrationCredentialEntity } from './integration-credential.entity';
import { IntegrationEntity } from './integration.entity';

@Injectable()
export class IntegrationsRepository extends TenantRepository<IntegrationEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(IntegrationEntity));
  }

  listForWorkspace(workspaceId: WorkspaceId): Promise<IntegrationEntity[]> {
    return this.ds.getRepository(IntegrationEntity).find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  insertIntegration(
    workspaceId: WorkspaceId,
    data: {
      provider: IntegrationProvider;
      name: string;
      status: IntegrationStatus;
      scopes: string[];
      externalAccountId: string | null;
      transcriptSharing: boolean;
      lastError: string | null;
      disconnectedAt: Date | null;
    },
    manager?: EntityManager,
  ): Promise<IntegrationEntity> {
    return this.insert(workspaceId, data, manager);
  }

  insertCredential(
    workspaceId: WorkspaceId,
    integrationId: string,
    sealed: Sealed,
    manager?: EntityManager,
  ): Promise<IntegrationCredentialEntity> {
    const repository = (manager ?? this.ds).getRepository(IntegrationCredentialEntity);
    return repository
      .insert({
        workspaceId,
        integrationId,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        tag: sealed.tag,
        keyVersion: sealed.keyVersion,
      })
      .then(async (result) => {
        const id = (result.identifiers[0] as { id?: string } | undefined)?.id;
        if (id === undefined) throw new Error('The integration credential insert returned no id.');
        const row = await repository.findOne({ where: { id, workspaceId } });
        if (row === null) throw new Error('The integration credential insert cannot be read back.');
        return row;
      });
  }

  async getCredential(
    workspaceId: WorkspaceId,
    integrationId: string,
    manager?: EntityManager,
  ): Promise<IntegrationCredentialEntity | null> {
    return (manager ?? this.ds).getRepository(IntegrationCredentialEntity).findOne({
      where: { workspaceId, integrationId },
    });
  }

  async deleteCredential(
    workspaceId: WorkspaceId,
    integrationId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await (manager ?? this.ds)
      .getRepository(IntegrationCredentialEntity)
      .delete({ workspaceId, integrationId });
  }

  async updateCredential(
    workspaceId: WorkspaceId,
    integrationId: string,
    sealed: Sealed,
    manager?: EntityManager,
  ): Promise<void> {
    await (manager ?? this.ds).getRepository(IntegrationCredentialEntity).update(
      { workspaceId, integrationId },
      {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        tag: sealed.tag,
        keyVersion: sealed.keyVersion,
      },
    );
  }
}
