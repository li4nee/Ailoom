// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { DocumentViewer } from '@/features/knowledge/components/document-viewer';

export const Route = createFileRoute(
  '/_app/w/$workspaceId/bots/$botId/knowledge/documents/$documentId',
)({
  component: function DocumentPage() {
    const { workspaceId, botId, documentId } = Route.useParams();
    return <DocumentViewer workspaceId={workspaceId} botId={botId} documentId={documentId} />;
  },
});
