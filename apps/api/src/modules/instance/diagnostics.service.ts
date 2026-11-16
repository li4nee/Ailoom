// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Client } from 'pg';
import { DataSource } from 'typeorm';

import type { Diagnostics, DiagnosticsCheck, DiagnosticsStatus } from '@app/shared';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { FILE_STORAGE, type FileStorage } from '../../common/storage';
import { DEFAULT_MODELS_DIR, localModelStatus } from '../../providers';
import { InstanceSettingsService } from './instance-settings.service';

const CHECK_TIMEOUT_MS = 2_000;
const WORKER_STALE_MS = 90_000;

interface CheckBase {
  status: DiagnosticsStatus;
  detail: string;
  fix: string | null;
}

interface HeartbeatRow {
  last_beat_at: string | Date;
}

interface VersionRow {
  extversion: string;
}

interface ReencryptRow {
  count: number;
}

interface QueueRow {
  name: string;
  created: string | number;
  active: string | number;
  failed24h: string | number;
}

function result(status: CheckBase['status'], detail: string, fix: string | null = null): CheckBase {
  return { status, detail, fix };
}

function errorResult(error: unknown, fix: string): CheckBase {
  const message = error instanceof Error ? error.message : String(error);
  return result('error', message, fix);
}

/** Runs each check with its own deadline. A hung dependency becomes an error, not a hung page. */
async function withinTimeout<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly ds: DataSource,
    private readonly settings: InstanceSettingsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async get(): Promise<Diagnostics> {
    const [email, encryption, storage, worker, pgvector, localModel, listen] = await Promise.all([
      this.emailCheck(),
      this.encryptionCheck(),
      this.storageCheck(),
      this.workerCheck(),
      this.pgvectorCheck(),
      this.localModelCheck(),
      this.listenCheck(),
    ]);
    const queues = await withinTimeout<Diagnostics['queues']>(() => this.queueCounts(), []);
    return {
      version: this.config.version,
      checks: { email, encryption, storage, worker, pgvector, localModel, listen },
      queues,
      signupMode: await this.settings.getSignupMode(),
    };
  }

  private async emailCheck(): Promise<DiagnosticsCheck> {
    return withinTimeout(
      // eslint-disable-next-line @typescript-eslint/require-await -- fallback value, no async work needed
      async () => {
        try {
          if (this.config.email.transport === 'none') {
            return result(
              'warn',
              'Email delivery is disabled.',
              'Set EMAIL_TRANSPORT to smtp or resend and fill in its settings.',
            );
          }
          return result('ok', `Email is configured through ${this.config.email.transport}.`);
        } catch (error) {
          return errorResult(error, 'Check the EMAIL_* environment variables.');
        }
      },
      result('error', 'The email check timed out.', 'Check the EMAIL_* environment variables.'),
    );
  }

  private async encryptionCheck(): Promise<
    DiagnosticsCheck & { keyVersions: number[]; rowsNeedingReencrypt: number }
  > {
    const keyVersions = this.config.encryptionKeys.map((key) => key.version).sort((a, b) => a - b);
    const active = this.config.encryptionKeys[0]?.version ?? 1;
    return withinTimeout(
      async () => {
        try {
          const rows = await this.ds.query<ReencryptRow[]>(
            `SELECT count(*)::int AS count
               FROM provider_credentials
              WHERE secret_ciphertext IS NOT NULL AND key_version IS NOT NULL
                AND key_version <> $1`,
            [active],
          );
          const rowsNeedingReencrypt = rows[0]?.count ?? 0;
          return rowsNeedingReencrypt === 0
            ? {
                ...result('ok', `Encryption key v${String(active)} is active.`),
                keyVersions,
                rowsNeedingReencrypt,
              }
            : {
                ...result(
                  'warn',
                  `${String(rowsNeedingReencrypt)} credential(s) still use an older key.`,
                  'Run the credential re-encryption job, or re-save those credentials.',
                ),
                keyVersions,
                rowsNeedingReencrypt,
              };
        } catch (error) {
          return {
            ...errorResult(error, 'Check ENCRYPTION_KEYS and the provider_credentials table.'),
            keyVersions,
            rowsNeedingReencrypt: 0,
          };
        }
      },
      {
        ...result('error', 'The encryption check timed out.', 'Check the database connection.'),
        keyVersions,
        rowsNeedingReencrypt: 0,
      },
    );
  }

  private async storageCheck(): Promise<DiagnosticsCheck> {
    const key = `diagnostics/${randomUUID()}`;
    return withinTimeout(
      async () => {
        try {
          await this.storage.put(key, Buffer.alloc(0));
          await this.storage.delete(key);
          return result('ok', 'The storage directory is writable.');
        } catch (error) {
          return errorResult(
            error,
            'Make STORAGE_DIR writable by the api and worker containers, or set it to a mounted volume.',
          );
        }
      },
      result('error', 'The storage check timed out.', 'Check the STORAGE_DIR mount.'),
    );
  }

  private async workerCheck(): Promise<DiagnosticsCheck & { lastBeatAt: string | null }> {
    return withinTimeout(
      async () => {
        try {
          const rows = await this.ds.query<HeartbeatRow[]>(
            `SELECT last_beat_at FROM worker_heartbeats ORDER BY last_beat_at DESC LIMIT 1`,
          );
          const last = rows[0]?.last_beat_at;
          if (last === undefined) {
            return {
              ...result(
                'error',
                'No worker has ever sent a heartbeat.',
                'Start the worker service and check its logs.',
              ),
              lastBeatAt: null,
            };
          }
          const at = last instanceof Date ? last : new Date(last);
          const lastBeatAt = at.toISOString();
          return this.clock.now().getTime() - at.getTime() > WORKER_STALE_MS
            ? {
                ...result(
                  'error',
                  `The last worker heartbeat was at ${lastBeatAt}.`,
                  'Start the worker service and check its logs.',
                ),
                lastBeatAt,
              }
            : { ...result('ok', `Worker last checked in at ${lastBeatAt}.`), lastBeatAt };
        } catch (error) {
          return {
            ...errorResult(error, 'Check the database and worker heartbeat table.'),
            lastBeatAt: null,
          };
        }
      },
      {
        ...result('error', 'The worker check timed out.', 'Check the database connection.'),
        lastBeatAt: null,
      },
    );
  }

  private async pgvectorCheck(): Promise<DiagnosticsCheck & { version: string }> {
    return withinTimeout(
      async () => {
        try {
          const rows = await this.ds.query<VersionRow[]>(
            `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
          );
          const version = rows[0]?.extversion ?? '';
          if (version === '') {
            return {
              ...result(
                'error',
                'The pgvector extension is not installed.',
                'Use the pgvector/pgvector:pg18 image and run migrations.',
              ),
              version,
            };
          }
          return {
            ...result(
              version.localeCompare('0.8.0', undefined, { numeric: true }) < 0 ? 'warn' : 'ok',
              `pgvector ${version} is installed.`,
              version.localeCompare('0.8.0', undefined, { numeric: true }) < 0
                ? 'Upgrade the postgres image to pgvector 0.8 or newer.'
                : null,
            ),
            version,
          };
        } catch (error) {
          return {
            ...errorResult(error, 'Check the database connection and pgvector installation.'),
            version: '',
          };
        }
      },
      {
        ...result('error', 'The pgvector check timed out.', 'Check the database connection.'),
        version: '',
      },
    );
  }

  private async localModelCheck(): Promise<DiagnosticsCheck> {
    return withinTimeout(
      // eslint-disable-next-line @typescript-eslint/require-await -- fallback value, no async work needed
      async () => {
        try {
          if (!this.config.localEmbeddings) {
            return result(
              'warn',
              'Built-in embeddings are disabled.',
              'Set LOCAL_EMBEDDINGS=true, or configure an external embedding provider for every bot.',
            );
          }
          const status = localModelStatus(DEFAULT_MODELS_DIR, this.config.localEmbeddingModel);
          return status === 'ready'
            ? result('ok', `${this.config.localEmbeddingModel} is ready.`)
            : result(
                'error',
                `${this.config.localEmbeddingModel} is missing.`,
                'Run pnpm --filter @app/api fetch-model (or rebuild the api image).',
              );
        } catch (error) {
          return errorResult(error, 'Run pnpm --filter @app/api fetch-model.');
        }
      },
      result(
        'error',
        'The local model check timed out.',
        'Run pnpm --filter @app/api fetch-model.',
      ),
    );
  }

  private async listenCheck(): Promise<DiagnosticsCheck> {
    return withinTimeout(
      async () => {
        const client = new Client({
          connectionString: this.config.database.listenUrl,
          connectionTimeoutMillis: CHECK_TIMEOUT_MS,
        });
        try {
          await client.connect();
          await client.query('SELECT 1');
          return result('ok', 'DATABASE_LISTEN_URL accepts connections.');
        } catch (error) {
          return errorResult(
            error,
            'Check DATABASE_LISTEN_URL and any PgBouncer or firewall in front of Postgres.',
          );
        } finally {
          await client.end().catch(() => undefined);
        }
      },
      result(
        'error',
        'The listen connection timed out.',
        'Check DATABASE_LISTEN_URL and any PgBouncer or firewall in front of Postgres.',
      ),
    );
  }

  private async queueCounts(): Promise<Diagnostics['queues']> {
    try {
      const rows = await this.ds.query<QueueRow[]>(
        `SELECT name,
                count(*) FILTER (WHERE state = 'created')::int AS created,
                count(*) FILTER (WHERE state = 'active')::int AS active,
                count(*) FILTER (
                  WHERE state = 'failed' AND completed_on > now() - interval '24 hours'
                )::int AS "failed24h"
           FROM pgboss.job
          GROUP BY name
          ORDER BY name`,
      );
      return rows.map((row) => ({
        name: row.name,
        created: Number(row.created),
        active: Number(row.active),
        failed24h: Number(row.failed24h),
      }));
    } catch {
      return [];
    }
  }
}
