// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotModelForm } from '@/features/bots/components/bot-model-form';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/model')({
  component: function BotModelPage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotModelForm workspaceId={workspaceId} botId={botId} />;
  },
});
