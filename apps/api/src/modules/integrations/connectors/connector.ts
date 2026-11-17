// SPDX-License-Identifier: AGPL-3.0-only
import type { IntegrationCapability, IntegrationEventType, IntegrationProvider } from '@app/shared';

export interface IntegrationCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface ConnectInput {
  provider: IntegrationProvider;
  scopes: readonly string[];
  credentials: IntegrationCredentials;
  externalAccountId: string | null;
}

export interface ConnectedAccount {
  externalAccountId: string | null;
  scopes: readonly string[];
}

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  scopes: readonly string[];
  externalAccountId: string | null;
  settings: { transcriptSharing: boolean };
  credentials: IntegrationCredentials;
}

export interface ConnectionHealth {
  ok: boolean;
  provider: IntegrationProvider;
  externalAccountId: string | null;
  detail?: string;
}

export interface IntegrationEvent {
  id: string;
  type: IntegrationEventType;
  workspaceId: string;
  aggregateId: string;
  occurredAt: string;
  version: 1;
  data: unknown;
}

export interface IntegrationConnector {
  readonly provider: IntegrationProvider;
  readonly capabilities: readonly IntegrationCapability[];
  connect(input: ConnectInput): Promise<ConnectedAccount>;
  disconnect(connection: IntegrationConnection): Promise<void>;
  test(connection: IntegrationConnection): Promise<ConnectionHealth>;
  handle(event: IntegrationEvent, connection: IntegrationConnection): Promise<void>;
}
