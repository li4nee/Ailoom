// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, type EntityManager, type Repository } from 'typeorm';

import type { EmailTokenType } from '@app/shared';

import { EmailTokenEntity } from './entities/email-token.entity';

/** One row to insert. The raw token never reaches this layer. */
export interface EmailTokenRow {
  userId: string | null;
  type: EmailTokenType;
  tokenHash: string;
  expiresAt: Date;
}

export type ConsumeTokenResult =
  { kind: 'ok'; token: EmailTokenEntity } | { kind: 'invalid' } | { kind: 'expired' };

/** The narrow storage port `EmailTokensService` needs; a fake implements it in unit tests. */
export interface EmailTokenStore {
  create(row: EmailTokenRow, manager?: EntityManager): Promise<void>;
  findByHash(tokenHash: string): Promise<EmailTokenEntity | null>;
  consume(
    tokenHash: string,
    type: EmailTokenType,
    now: Date,
    manager?: EntityManager,
  ): Promise<ConsumeTokenResult>;
}

@Injectable()
export class EmailTokensRepository implements EmailTokenStore {
  constructor(private readonly ds: DataSource) {}

  async create(row: EmailTokenRow, manager?: EntityManager): Promise<void> {
    await this.repository(manager).insert(row);
  }

  async findByHash(tokenHash: string): Promise<EmailTokenEntity | null> {
    return this.repository().findOne({ where: { tokenHash } });
  }

  /**
   * Marks a matching unused token used inside a transaction. `FOR UPDATE` makes two concurrent
   * consumptions of the same link serialize; the second sees `usedAt` and fails. A type
   * mismatch is indistinguishable from an unknown token.
   */
  async consume(
    tokenHash: string,
    type: EmailTokenType,
    now: Date,
    manager?: EntityManager,
  ): Promise<ConsumeTokenResult> {
    const run = async (m: EntityManager): Promise<ConsumeTokenResult> => {
      const repository = m.getRepository(EmailTokenEntity);
      const token = await repository
        .createQueryBuilder('token')
        .setLock('pessimistic_write')
        .where('token.tokenHash = :tokenHash', { tokenHash })
        .getOne();
      if (token?.type !== type || token.usedAt !== null) {
        return { kind: 'invalid' };
      }
      if (token.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };
      await repository.update({ id: token.id, usedAt: IsNull() }, { usedAt: now });
      return { kind: 'ok', token };
    };
    return manager === undefined ? this.ds.transaction(run) : run(manager);
  }

  private repository(manager?: EntityManager): Repository<EmailTokenEntity> {
    return manager === undefined
      ? this.ds.getRepository(EmailTokenEntity)
      : manager.getRepository(EmailTokenEntity);
  }
}
