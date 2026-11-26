// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotTools } from '@/features/tools/components/bot-tools';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/tools')({
  component: function BotToolsPage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotTools workspaceId={workspaceId} botId={botId} />;
  },
});
