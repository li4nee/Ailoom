// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { BotInstructions } from '@/features/bots/components/bot-instructions';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/instructions')({
  validateSearch: z.object({ versionId: z.uuid().optional().catch(undefined) }),
  component: function BotInstructionsPage() {
    const { workspaceId, botId } = Route.useParams();
    const { versionId } = Route.useSearch();
    return (
      <BotInstructions
        key={JSON.stringify([workspaceId, botId, versionId])}
        workspaceId={workspaceId}
        botId={botId}
        {...(versionId === undefined ? {} : { versionId })}
      />
    );
  },
});
