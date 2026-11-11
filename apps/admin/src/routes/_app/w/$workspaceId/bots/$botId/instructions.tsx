// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotInstructions } from '@/features/bots/components/bot-instructions';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/instructions')({
  component: function BotInstructionsPage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotInstructions workspaceId={workspaceId} botId={botId} />;
  },
});
