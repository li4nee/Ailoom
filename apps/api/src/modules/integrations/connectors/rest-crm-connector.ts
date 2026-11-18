// SPDX-License-Identifier: AGPL-3.0-only
import type { AppConfig } from '../../../common/config';
import { safeFetch, webhookPolicy, type FetchPolicy } from '../../../common/safe-fetch';
import type {
  ConnectionHealth,
  ConnectInput,
  ConnectorHandleResult,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationEvent,
} from './connector';

export interface CrmConnectorSpec {
  provider: IntegrationConnector['provider'];
  capabilities: IntegrationConnector['capabilities'];
  baseUrl: string;
  healthPath: string;
  contactPath: string;
  contactObjectType: string;
  handoffPath: string | null;
  handoffObjectType: string | null;
  timelinePath: string | null;
}

type ConnectorFetch = (
  input: string | URL,
  init: RequestInit & { signal?: AbortSignal },
  policy: FetchPolicy,
) => Promise<Response>;

export class ConnectorAuthError extends Error {
  readonly reauthRequired = true;
}

export class ConnectorTransientError extends Error {}

export class RestCrmConnector implements IntegrationConnector {
  readonly provider: IntegrationConnector['provider'];
  readonly capabilities: IntegrationConnector['capabilities'];

  constructor(
    private readonly spec: CrmConnectorSpec,
    private readonly config: AppConfig,
    private readonly fetcher: ConnectorFetch = safeFetch,
  ) {
    this.provider = spec.provider;
    this.capabilities = spec.capabilities;
  }

  connect(
    input: ConnectInput,
  ): Promise<{ externalAccountId: string | null; scopes: readonly string[] }> {
    return Promise.resolve({
      externalAccountId: input.externalAccountId,
      scopes: input.scopes,
    });
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  async test(connection: IntegrationConnection): Promise<ConnectionHealth> {
    const response = await this.request(connection, this.spec.healthPath, 'GET');
    await response.arrayBuffer();
    return {
      ok: response.status >= 200 && response.status < 300,
      provider: this.provider,
      externalAccountId: connection.externalAccountId,
      ...(response.status === 401 || response.status === 403 ? { detail: 'reauth_required' } : {}),
    };
  }

  async handle(
    event: IntegrationEvent,
    connection: IntegrationConnection,
  ): Promise<ConnectorHandleResult> {
    let operation: {
      path: string | null;
      objectType: string | null;
      body: Record<string, unknown>;
    };
    if (event.type === 'contact.created' || event.type === 'contact.updated') {
      operation = {
        path: this.spec.contactPath,
        objectType: this.spec.contactObjectType,
        body: { properties: this.contactProperties(event.data) },
      };
    } else if (event.type === 'handoff.requested') {
      operation = {
        path: this.spec.handoffPath,
        objectType: this.spec.handoffObjectType,
        body: { event: event.data, sourceEventId: event.id },
      };
    } else if (event.type === 'conversation.closed') {
      operation = {
        path: this.spec.timelinePath,
        objectType: 'timeline',
        body: { event: event.data, sourceEventId: event.id },
      };
    } else {
      return {};
    }
    if (operation.path === null || operation.objectType === null) return {};
    const response = await this.request(
      connection,
      operation.path,
      'POST',
      operation.body,
      event.id,
    );
    const raw = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorAuthError(`${this.provider} authentication was rejected`);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ConnectorTransientError(`${this.provider} returned ${String(response.status)}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${this.provider} returned ${String(response.status)}`);
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // A successful provider may return an empty body; the mapping remains event-id based.
    }
    const externalObjectId =
      response.headers.get('x-external-id') ??
      (typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof parsed.id === 'string'
        ? parsed.id
        : undefined);
    return {
      ...(externalObjectId === undefined ? {} : { externalObjectId }),
      externalObjectType: operation.objectType,
      idempotencyKey: event.id,
    };
  }

  private contactProperties(data: unknown): Record<string, unknown> {
    if (typeof data !== 'object' || data === null) return {};
    const value = data as Record<string, unknown>;
    const externalId = value['externalId'];
    const email = value['email'];
    const name = value['name'];
    return {
      ...(typeof externalId === 'string' ? { external_id: externalId } : {}),
      ...(typeof email === 'string' ? { email } : {}),
      ...(typeof name === 'string' ? { name } : {}),
    };
  }

  private async request(
    connection: IntegrationConnection,
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Response> {
    const baseUrl = connection.credentials.baseUrl ?? this.spec.baseUrl;
    const url = new URL(path, baseUrl).toString();
    return this.fetcher(
      url,
      {
        method,
        headers: {
          authorization: `Bearer ${connection.credentials.accessToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      webhookPolicy(this.config),
    );
  }
}
