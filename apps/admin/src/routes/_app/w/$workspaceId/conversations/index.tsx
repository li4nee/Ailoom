// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { Inbox } from '@/features/conversations/components/inbox';

const searchSchema = z.object({
  botId: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
});

export const Route = createFileRoute('/_app/w/$workspaceId/conversations/')({
  validateSearch: searchSchema,
  component: function InboxPage() {
    const { workspaceId } = Route.useParams();
    const filters = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <Inbox
        workspaceId={workspaceId}
        filters={filters}
        onFiltersChange={(next) => {
          void navigate({ search: next, replace: true });
        }}
      />
    );
  },
});
