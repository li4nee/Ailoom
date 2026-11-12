// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { RoleGate } from '@/components/role-gate';
import { BotCreateForm } from '@/features/bots/components/bot-create-form';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/new')({
  component: function NewBotPage() {
    const { workspaceId } = Route.useParams();
    const navigate = useNavigate();
    return (
      <RoleGate min="admin">
        <h1 className="mb-4 text-2xl font-semibold">{strings.bots.newBot}</h1>
        <BotCreateForm
          workspaceId={workspaceId}
          onCreated={(bot) => {
            void navigate({
              to: '/w/$workspaceId/bots/$botId/general',
              params: { workspaceId, botId: bot.id },
            });
          }}
        />
      </RoleGate>
    );
  },
});
