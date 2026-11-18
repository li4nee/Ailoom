// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { SavedRepliesPanel } from '@/features/saved-replies/saved-replies-panel';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/saved-replies')({
  component: SavedRepliesPage,
});

function SavedRepliesPage() {
  const { workspaceId } = Route.useParams();
  return <SavedRepliesPanel workspaceId={workspaceId} />;
}
