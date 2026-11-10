// SPDX-License-Identifier: AGPL-3.0-only

/** Emitted after a workspace and its owner membership commit (Task 2.6 listens for setup). */
export const WORKSPACE_CREATED = 'workspace.created';

export interface WorkspaceCreatedEvent {
  workspaceId: string;
  ownerId: string;
}
