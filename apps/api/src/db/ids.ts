// SPDX-License-Identifier: AGPL-3.0-only
import { AppError } from '../common/errors';

declare const brand: unique symbol;

type Branded<T, Name extends string> = T & { readonly [brand]: Name };

export type WorkspaceId = Branded<string, 'WorkspaceId'>;
export type UserId = Branded<string, 'UserId'>;
export type BotId = Branded<string, 'BotId'>;
export type ContactId = Branded<string, 'ContactId'>;
export type ConversationId = Branded<string, 'ConversationId'>;
export type CredentialId = Branded<string, 'CredentialId'>;
export type SourceId = Branded<string, 'SourceId'>;
export type MessageId = Branded<string, 'MessageId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Malformed ids must not distinguish themselves from ids that do not exist. */
function parse(value: string): string {
  if (!isUuid(value)) throw new AppError('not_found', { cause: value });
  return value;
}

export const asWorkspaceId = (value: string): WorkspaceId => parse(value) as WorkspaceId;
export const asUserId = (value: string): UserId => parse(value) as UserId;
export const asBotId = (value: string): BotId => parse(value) as BotId;
export const asContactId = (value: string): ContactId => parse(value) as ContactId;
export const asConversationId = (value: string): ConversationId => parse(value) as ConversationId;
export const asCredentialId = (value: string): CredentialId => parse(value) as CredentialId;
export const asSourceId = (value: string): SourceId => parse(value) as SourceId;
export const asMessageId = (value: string): MessageId => parse(value) as MessageId;
