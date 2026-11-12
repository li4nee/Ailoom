// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotGeneralForm } from '@/features/bots/components/bot-general-form';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/general')({
  component: function BotGeneralPage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotGeneralForm workspaceId={workspaceId} botId={botId} />;
  },
});
