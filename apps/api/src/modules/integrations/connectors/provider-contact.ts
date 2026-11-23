// SPDX-License-Identifier: AGPL-3.0-only
import type { ConnectorHandleResult, IntegrationEvent } from './connector';
import {
  ConnectorAuthError,
  ConnectorRejectedError,
  ConnectorTransientError,
} from './rest-crm-connector';

export interface ContactIdentity {
  email: string;
  name: string;
  externalId: string | null;
}

export function contactIdentity(event: IntegrationEvent): ContactIdentity | null {
  if (typeof event.data !== 'object' || event.data === null) return null;
  const data = event.data as Record<string, unknown>;
  const email = typeof data['email'] === 'string' ? data['email'].trim().toLowerCase() : '';
  const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
  const externalId = typeof data['externalId'] === 'string' ? data['externalId'].trim() : '';
  if (email === '' && externalId === '') return null;
  return { email, name, externalId: externalId === '' ? null : externalId };
}

export function nameParts(name: string): { firstName: string; lastName: string } {
  const [firstName = '', ...lastName] = name.split(/\s+/u).filter(Boolean);
  return { firstName, lastName: lastName.join(' ') };
}

export function requireContactName(identity: ContactIdentity): string | null {
  return identity.name === '' ? null : identity.name;
}

export async function readProviderResponse(response: Response, provider: string): Promise<unknown> {
  if (response.status === 401 || response.status === 403) {
    throw new ConnectorAuthError(`${provider} authentication was rejected`, response.status);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new ConnectorTransientError(
      `${provider} returned ${String(response.status)}`,
      response.status,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ConnectorRejectedError(
      `${provider} returned ${String(response.status)}`,
      response.status,
    );
  }
  const raw = await response.text();
  if (raw === '') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ConnectorRejectedError(`${provider} returned invalid JSON`, response.status);
  }
}

export function getStringAt(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current !== '' ? current : undefined;
}

export function contactResult(
  event: IntegrationEvent,
  response: Response,
  externalObjectId: string | undefined,
  externalObjectType: string,
): ConnectorHandleResult {
  if (externalObjectId === undefined) {
    throw new ConnectorRejectedError(
      'Provider response did not include an object ID',
      response.status,
    );
  }
  return {
    externalObjectId,
    externalObjectType,
    idempotencyKey: event.id,
    statusCode: response.status,
  };
}
