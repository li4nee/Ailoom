// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Raw SQL: these probes read the server and its catalog (no entity involved), and must stay
 * a single cheap round trip each.
 */
@Injectable()
export class ReadinessRepository {
  constructor(private readonly ds: DataSource) {}

  async ping(): Promise<void> {
    await this.ds.query('SELECT 1');
  }

  /** The installed pgvector version, or null when the extension is missing. */
  async pgvectorVersion(): Promise<string | null> {
    const rows = await this.ds.query<{ extversion: string }[]>(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    return rows[0]?.extversion ?? null;
  }

  /** True when a migration shipped with this build has not been applied yet. */
  hasPendingMigrations(): Promise<boolean> {
    return this.ds.showMigrations();
  }
}
