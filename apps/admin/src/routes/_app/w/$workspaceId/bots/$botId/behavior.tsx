// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotBehaviorForm } from '@/features/bots/components/bot-behavior-form';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/behavior')({
  component: function BotBehaviorPage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotBehaviorForm workspaceId={workspaceId} botId={botId} />;
  },
});
