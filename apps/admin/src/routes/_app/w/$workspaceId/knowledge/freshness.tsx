// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';

import { FreshnessReport } from '@/features/knowledge/components/freshness-report';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/knowledge/freshness')({
  validateSearch: z.object({
    days: z.coerce.number().int().min(7).max(365).catch(90),
    botId: z.string().optional(),
  }),
  component: function KnowledgeFreshnessPage() {
    const { workspaceId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <div className="space-y-5">
        <header className="space-y-2">
          <Link
            to="/w/$workspaceId/knowledge"
            params={{ workspaceId }}
            className="text-sm underline"
          >
            {strings.nav.knowledge}
          </Link>
          <h1 className="text-2xl font-semibold">{strings.knowledge.freshness.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.knowledge.freshness.intro}</p>
        </header>
        <FreshnessReport
          workspaceId={workspaceId}
          filters={{
            days: search.days,
            ...(search.botId === undefined ? {} : { botId: search.botId }),
          }}
          onChange={(filters) =>
            void navigate({
              search: {
                days: filters.days,
                ...(filters.botId === undefined ? {} : { botId: filters.botId }),
              },
            })
          }
        />
      </div>
    );
  },
});
