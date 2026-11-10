// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { EmailTokenType } from '@app/shared';

import { EmailTokenEntity } from './entities/email-token.entity';

/** One row to insert. The raw token never reaches this layer. */
export interface EmailTokenRow {
  userId: string | null;
  type: EmailTokenType;
  tokenHash: string;
  expiresAt: Date;
}

/** The narrow storage port `EmailTokensService` needs; a fake implements it in unit tests. */
export interface EmailTokenStore {
  create(row: EmailTokenRow, manager?: EntityManager): Promise<void>;
}

@Injectable()
export class EmailTokensRepository implements EmailTokenStore {
  constructor(private readonly ds: DataSource) {}

  async create(row: EmailTokenRow, manager?: EntityManager): Promise<void> {
    const repository =
      manager === undefined
        ? this.ds.getRepository(EmailTokenEntity)
        : manager.getRepository(EmailTokenEntity);
    await repository.insert(row);
  }
}
