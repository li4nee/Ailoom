// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { BotAppearanceForm } from '@/features/bots/components/bot-appearance-form';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/appearance')({
  component: function BotAppearancePage() {
    const { workspaceId, botId } = Route.useParams();
    return <BotAppearanceForm workspaceId={workspaceId} botId={botId} />;
  },
});
