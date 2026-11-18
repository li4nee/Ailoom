// SPDX-License-Identifier: AGPL-3.0-only
import type { ContactId, WorkspaceId } from '../db/ids';

/** Emitted after an identified contact update commits. The integration outbox consumes this later. */
export const CONTACT_UPDATED = 'contact.updated';

export interface ContactUpdatedEvent {
  workspaceId: WorkspaceId;
  contactId: ContactId;
}
