// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { ConversationDetail } from '@/features/conversations/components/conversation-detail';

export const Route = createFileRoute('/_app/w/$workspaceId/conversations/$conversationId')({
  component: function ConversationPage() {
    const { workspaceId, conversationId } = Route.useParams();
    return <ConversationDetail workspaceId={workspaceId} conversationId={conversationId} />;
  },
});
