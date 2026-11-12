// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotInstall } from '@/features/bots/components/bot-install';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/install')({
  component: function BotInstallPage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotInstall workspaceId={workspaceId} botId={botId} />;
  },
});
