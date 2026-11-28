// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotInteractionsForm } from '@/features/bots/components/bot-interactions-form';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/interactions')({
  component: function BotInteractionsPage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotInteractionsForm workspaceId={workspaceId} botId={botId} />;
  },
});
