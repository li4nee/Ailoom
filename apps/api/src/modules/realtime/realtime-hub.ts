// SPDX-License-Identifier: AGPL-3.0-only
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Client, type Notification } from 'pg';

import { REALTIME_EVENT_TYPES, type RealtimeEvent } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { buildSsl } from '../../db/data-source';
import type { WorkspaceId } from '../../db/ids';
import { workspaceChannel } from './notify';

export type RealtimeFilter = (event: RealtimeEvent) => boolean;
export type RealtimeListener = (event: RealtimeEvent) => void;

interface Subscriber {
  filter: RealtimeFilter;
  onEvent: RealtimeListener;
}

/** First retry delay; doubles up to `MAX_BACKOFF_MS` (spec §18.3). */
export const RECONNECT_INITIAL_MS = 500;
export const RECONNECT_MAX_MS = 30_000;

const LISTEN_FAILED_MESSAGE =
  'LISTEN connection could not be established (is DATABASE_URL a PgBouncer transaction pool? ' +
  'set DATABASE_LISTEN_URL)';

const ignore = (): void => {
  // Best-effort cleanup: the connection is already gone.
};

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Recognises the events this build sends; an unknown payload is logged and dropped. */
function parseEvent(payload: string): RealtimeEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && (REALTIME_EVENT_TYPES as readonly string[]).includes(type)
    ? (value as RealtimeEvent)
    : null;
}

/**
 * One dedicated `LISTEN` connection per API process, fanning notifications out to the in-memory
 * SSE subscribers of the workspaces they asked for (spec §18.3). A workspace is listened to
 * while it has at least one subscriber, and only then.
 *
 * When the connection drops (e.g. Postgres restarts) it reconnects with exponential backoff,
 * re-issues every `LISTEN` and emits `resync`, because notifications sent while it was down are
 * lost for good. Subscribers stay registered throughout, so an open SSE stream survives.
 */
@Injectable()
export class RealtimeHub implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeHub.name);
  /** Channels that must be listened to: every one with at least one subscriber. */
  private readonly channels = new Set<string>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = RECONNECT_INITIAL_MS;
  private stopped = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Connects at boot so a misconfigured instance fails early: in production an unreachable
   * LISTEN URL stops the process with an actionable message; elsewhere (and in tests) the hub
   * keeps retrying in the background.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureConnected();
    } catch (error) {
      if (this.config.nodeEnv === 'production') {
        throw new AppError('internal_error', { message: LISTEN_FAILED_MESSAGE, cause: error });
      }
      this.logger.warn(
        `${LISTEN_FAILED_MESSAGE}: ${error instanceof Error ? error.message : String(error)} — retrying in the background.`,
      );
      this.scheduleReconnect();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.client;
    this.client = null;
    if (client !== null) await client.end().catch(ignore);
  }

  /**
   * Calls `onEvent` for every event of `workspaceId` that passes `filter`. Returns the
   * unsubscribe function; the last subscriber of a workspace stops its `LISTEN`.
   */
  subscribe(
    workspaceId: WorkspaceId,
    filter: RealtimeFilter,
    onEvent: RealtimeListener,
  ): () => void {
    const channel = workspaceChannel(workspaceId);
    let set = this.subscribers.get(channel);
    if (set === undefined) {
      set = new Set<Subscriber>();
      this.subscribers.set(channel, set);
    }
    const subscriber: Subscriber = { filter, onEvent };
    set.add(subscriber);

    if (set.size === 1) {
      this.channels.add(channel);
      void this.listenChannel(channel);
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.subscribers.get(channel);
      if (current === undefined) return;
      current.delete(subscriber);
      if (current.size > 0) return;
      this.subscribers.delete(channel);
      this.channels.delete(channel);
      void this.unlistenChannel(channel);
    };
  }

  private async connect(): Promise<void> {
    const ssl = buildSsl(this.config.database);
    const client = new Client({
      connectionString: this.config.database.listenUrl,
      ...(ssl === false ? {} : { ssl }),
      application_name: 'ailoom-listen',
    });

    let lost = false;
    const onLost = (reason: string): void => {
      if (lost) return;
      lost = true;
      if (this.client === client) this.client = null;
      if (this.stopped) return;
      this.logger.warn(`LISTEN connection lost (${reason}); reconnecting.`);
      this.scheduleReconnect();
    };
    client.on('notification', (message) => {
      this.dispatch(message);
    });
    client.on('error', (error: Error) => {
      onLost(error.message);
    });
    client.on('end', () => {
      onLost('connection ended');
    });

    try {
      await client.connect();
    } catch (error) {
      lost = true;
      await client.end().catch(ignore);
      throw error;
    }
    if (this.stopped) {
      await client.end().catch(ignore);
      return;
    }

    this.client = client;
    this.backoffMs = RECONNECT_INITIAL_MS;
    for (const channel of this.channels) await this.listenOn(client, channel);
    // Notifications sent while the connection was down are gone: every subscriber refetches.
    this.emitResync();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client !== null) return;
    if (this.connecting !== null) {
      await this.connecting;
      return;
    }
    const pending = this.connect().finally(() => {
      this.connecting = null;
    });
    this.connecting = pending;
    await pending;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
    const timer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch((error: unknown) => {
        this.logger.warn(
          `LISTEN reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.scheduleReconnect();
      });
    }, delay);
    timer.unref();
    this.reconnectTimer = timer;
  }

  private async listenChannel(channel: string): Promise<void> {
    try {
      await this.ensureConnected();
      const client = this.client;
      if (client !== null && this.channels.has(channel)) await this.listenOn(client, channel);
    } catch (error) {
      // The connection is down; `connect()` re-issues every channel on the next attempt.
      this.logger.warn(
        `LISTEN ${channel} deferred: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.scheduleReconnect();
    }
  }

  private async unlistenChannel(channel: string): Promise<void> {
    const client = this.client;
    if (client === null) return;
    try {
      await client.query(`UNLISTEN ${quoteIdentifier(channel)}`);
    } catch (error) {
      this.logger.warn(
        `UNLISTEN ${channel} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async listenOn(client: Client, channel: string): Promise<void> {
    // Raw SQL: LISTEN/UNLISTEN take an identifier, which cannot be a bound parameter. The name
    // is built from a workspace UUID, never from user input.
    await client.query(`LISTEN ${quoteIdentifier(channel)}`);
  }

  private dispatch(message: Notification): void {
    const subscribers = this.subscribers.get(message.channel);
    const payload = message.payload;
    if (subscribers === undefined || payload === undefined) return;
    const event = parseEvent(payload);
    if (event === null) {
      this.logger.warn(`Dropping a malformed notification on ${message.channel}.`);
      return;
    }
    for (const subscriber of subscribers) {
      if (subscriber.filter(event)) subscriber.onEvent(event);
    }
  }

  private emitResync(): void {
    const resync: RealtimeEvent = { type: 'resync' };
    for (const subscribers of this.subscribers.values()) {
      for (const subscriber of subscribers) {
        if (subscriber.filter(resync)) subscriber.onEvent(resync);
      }
    }
  }
}
