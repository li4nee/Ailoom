// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ZodError } from 'zod';

import type {
  CreateCredentialRequest,
  ProviderErrorCode,
  ProviderKind,
  UpdateCredentialRequest,
} from '@app/shared';
import { createCredentialSchema, updateCredentialSchema } from '@app/shared';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { SecretBox } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { asCredentialId, type CredentialId, type UserId, type WorkspaceId } from '../../db/ids';
import { isForeignKeyViolation } from '../../db/postgres-errors';
import type { CredentialResolver, ResolvedCredential } from '../../providers';
import { CredentialsRepository } from './credentials.repository';
import type { ProviderCredentialEntity } from './provider-credential.entity';

/** Providers reached at an admin-supplied base URL. */
const NEEDS_BASE_URL: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  'ollama',
  'openai_compatible',
]);

const ACCEPTS_KEY: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'mistral',
  'openai_compatible',
  'mock',
]);

interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

function validationError(error: ZodError): AppError {
  return new AppError('validation_failed', {
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

/**
 * Provider credentials (spec §11.1): sealed at rest, resolved for the `Llm` service, and never
 * returned. The plaintext key exists only inside `create`/`update`/`resolveForUse`.
 */
@Injectable()
export class CredentialsService implements CredentialResolver {
  constructor(
    private readonly ds: DataSource,
    private readonly repository: CredentialsRepository,
    private readonly secrets: SecretBox,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    workspaceId: WorkspaceId,
    input: CreateCredentialRequest,
    actor: UserId,
  ): Promise<ProviderCredentialEntity> {
    const parsed = createCredentialSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const credential = parsed.data;
    if (credential.provider === 'mock' && this.config.nodeEnv === 'production') {
      throw new AppError('validation_failed', {
        message: 'The mock provider is only available outside production.',
      });
    }

    // `apiKey` and `baseUrl` exist on some members of the union only; their absence is the
    // "this provider does not take one" signal, which the schema has already enforced.
    const apiKey = 'apiKey' in credential ? credential.apiKey : undefined;
    const baseUrl = 'baseUrl' in credential ? credential.baseUrl : null;
    const sealed = apiKey === undefined ? null : this.seal(apiKey);

    return this.ds.transaction(async (manager) => {
      const created = await this.repository.insert(
        workspaceId,
        {
          provider: credential.provider,
          label: credential.label,
          baseUrl,
          secretLast4: apiKey?.slice(-4) ?? null,
          ...this.sealedColumns(sealed),
        },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'credential.created',
          targetType: 'credential',
          targetId: created.id,
          metadata: { provider: created.provider, label: created.label },
        },
        manager,
      );
      return created;
    });
  }

  async update(
    workspaceId: WorkspaceId,
    id: string,
    input: UpdateCredentialRequest,
    actor: UserId,
  ): Promise<ProviderCredentialEntity> {
    const parsed = updateCredentialSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);

    return this.ds.transaction(async (manager) => {
      const existing = await this.repository.getById(workspaceId, id, 'not_found', manager);
      this.assertEditable(existing);
      this.assertFieldsAllowed(existing.provider, parsed.data);

      const patch: QueryDeepPartialEntity<ProviderCredentialEntity> = {
        updatedAt: this.clock.now(),
      };
      const changed: string[] = [];
      if (parsed.data.label !== undefined) {
        patch.label = parsed.data.label;
        changed.push('label');
      }
      if (parsed.data.apiKey !== undefined) {
        Object.assign(patch, this.sealedColumns(this.seal(parsed.data.apiKey)));
        patch.secretLast4 = parsed.data.apiKey.slice(-4);
        changed.push('apiKey');
      }
      if (parsed.data.baseUrl !== undefined) {
        patch.baseUrl = parsed.data.baseUrl;
        changed.push('baseUrl');
      }
      if (changed.length === 0) return existing;

      const updated = await this.repository.updateById(workspaceId, id, patch, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'credential.updated',
          targetType: 'credential',
          targetId: updated.id,
          metadata: { changed },
        },
        manager,
      );
      return updated;
    });
  }

  /**
   * Spec §17.4: a credential a live bot uses cannot be deleted. Soft-deleted bots do not count;
   * their rows are removed here because their foreign keys would otherwise block the delete.
   */
  async delete(workspaceId: WorkspaceId, id: string, actor: UserId): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const existing = await this.repository.getById(workspaceId, id, 'not_found', manager);
      this.assertEditable(existing);
      // Everything below runs on `manager`: the hard delete of soft-deleted bots must roll back
      // with the credential delete, or a failed delete would still have erased their history.
      await this.repository.lockForDelete(workspaceId, id, manager);
      if ((await this.repository.countLiveBotsUsing(workspaceId, id, manager)) > 0) {
        throw new AppError('credential_in_use');
      }
      await this.repository.deleteSoftDeletedBotsUsing(workspaceId, id, manager);
      try {
        await this.repository.deleteById(workspaceId, id, manager);
      } catch (error) {
        // A bot created while this transaction ran still holds the key.
        if (isForeignKeyViolation(error)) throw new AppError('credential_in_use', { cause: error });
        throw error;
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'credential.deleted',
          targetType: 'credential',
          targetId: id,
          metadata: { provider: existing.provider, label: existing.label },
        },
        manager,
      );
    });
  }

  async list(workspaceId: WorkspaceId): Promise<ProviderCredentialEntity[]> {
    return this.repository.listAll(workspaceId);
  }

  async get(workspaceId: WorkspaceId, id: string): Promise<ProviderCredentialEntity> {
    return this.repository.getById(workspaceId, id);
  }

  /** The workspace's built-in local embedding credential, if it has one (Task 2.6). */
  async getLocal(workspaceId: WorkspaceId): Promise<ProviderCredentialEntity | null> {
    return this.repository.findByProvider(workspaceId, 'local');
  }

  /** Used by `Llm`: loads the row inside the workspace and decrypts it for one call. */
  async resolveForUse(workspaceId: WorkspaceId, id: CredentialId): Promise<ResolvedCredential> {
    const credential = await this.repository.getById(workspaceId, id);
    return {
      id: asCredentialId(credential.id),
      workspaceId,
      provider: credential.provider,
      apiKey: this.open(credential),
      baseUrl: credential.baseUrl,
      updatedAt: credential.updatedAt,
    };
  }

  async markUsed(workspaceId: WorkspaceId, id: string): Promise<ProviderCredentialEntity> {
    await this.repository.recordSuccess(workspaceId, id, this.clock.now());
    return this.repository.getById(workspaceId, id);
  }

  async markError(
    workspaceId: WorkspaceId,
    id: string,
    code: ProviderErrorCode,
  ): Promise<ProviderCredentialEntity> {
    await this.repository.recordError(workspaceId, id, code, this.clock.now());
    return this.repository.getById(workspaceId, id);
  }

  private seal(apiKey: string): SealedSecret {
    return this.secrets.seal(apiKey);
  }

  private sealedColumns(sealed: SealedSecret | null): {
    secretCiphertext: Buffer | null;
    secretIv: Buffer | null;
    secretTag: Buffer | null;
    keyVersion: number | null;
  } {
    return sealed === null
      ? { secretCiphertext: null, secretIv: null, secretTag: null, keyVersion: null }
      : {
          secretCiphertext: sealed.ciphertext,
          secretIv: sealed.iv,
          secretTag: sealed.tag,
          keyVersion: sealed.keyVersion,
        };
  }

  private open(credential: ProviderCredentialEntity): string | null {
    const { secretCiphertext, secretIv, secretTag, keyVersion } = credential;
    if (secretCiphertext === null && secretIv === null && secretTag === null) return null;
    if (
      secretCiphertext === null ||
      secretIv === null ||
      secretTag === null ||
      keyVersion === null
    ) {
      throw new AppError('internal_error', {
        message: 'The stored credential is incomplete.',
      });
    }
    try {
      return this.secrets.open({
        ciphertext: secretCiphertext,
        iv: secretIv,
        tag: secretTag,
        keyVersion,
      });
    } catch (error) {
      throw new AppError('internal_error', { cause: error });
    }
  }

  /** The built-in credential is provisioned by the platform, never edited by an admin. */
  private assertEditable(credential: ProviderCredentialEntity): void {
    if (credential.provider === 'local') throw new AppError('credential_builtin');
  }

  /** Rejects a patch that names a field the provider does not use (e.g. a key for Ollama). */
  private assertFieldsAllowed(provider: ProviderKind, input: UpdateCredentialRequest): void {
    if (input.apiKey !== undefined && !ACCEPTS_KEY.has(provider)) {
      throw new AppError('validation_failed', {
        details: [{ path: 'apiKey', message: 'This provider has no API key.' }],
      });
    }
    if (input.baseUrl !== undefined && !NEEDS_BASE_URL.has(provider)) {
      throw new AppError('validation_failed', {
        details: [{ path: 'baseUrl', message: 'This provider does not use a base URL.' }],
      });
    }
  }
}
