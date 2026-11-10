// SPDX-License-Identifier: AGPL-3.0-only
import { isIP } from 'node:net';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { AuditEntryDto, Page } from '@app/shared';

import { RequestContextService } from '../../common/context/request-context';
import { AppError } from '../../common/errors';
import type { AuditEntryInput, AuditWriter } from '../../common/ports/audit';
import { isUuid, type WorkspaceId } from '../../db/ids';
import { toAuditEntryDto } from './audit.mapper';
import { AuditRepository } from './audit.repository';

/** Keys that must never reach the audit table, at any depth. */
const SECRET_KEY = /secret|password|token|api.?key|authorization|cookie/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => scrub(item));
  if (typeof value !== 'object' || value === null) return value;
  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    clean[key] = scrub(child);
  }
  return clean;
}

/**
 * Writes the operation log (spec §9.6). Metadata is scrubbed here, at the only write path, so
 * a caller cannot accidentally persist a credential. `record` joins the caller's transaction
 * when given its manager: a rolled-back change leaves no audit row.
 */
@Injectable()
export class AuditService implements AuditWriter {
  constructor(
    private readonly repository: AuditRepository,
    private readonly context: RequestContextService,
  ) {}

  async record(entry: AuditEntryInput, manager?: EntityManager): Promise<void> {
    if (entry.targetId !== null && !isUuid(entry.targetId)) {
      throw new AppError('validation_failed', {
        details: [{ path: 'targetId', message: 'Must be a UUID.' }],
      });
    }
    const ip = entry.ip ?? this.context.ip() ?? null;
    await this.repository.insert(
      {
        workspaceId: entry.workspaceId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: scrub(entry.metadata ?? {}) as Record<string, unknown>,
        // An `inet` column rejects garbage; a malformed forwarded value must not fail the action.
        ip: ip !== null && isIP(ip) !== 0 ? ip : null,
      },
      manager,
    );
  }

  async list(
    workspaceId: WorkspaceId,
    options: { limit: number; cursor?: string | undefined },
  ): Promise<Page<AuditEntryDto>> {
    const page = await this.repository.list(workspaceId, {
      limit: options.limit,
      cursor: options.cursor ?? null,
    });
    return { data: page.data.map(toAuditEntryDto), nextCursor: page.nextCursor };
  }
}
