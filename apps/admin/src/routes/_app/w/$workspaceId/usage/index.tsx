// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { defaultUsageRange } from '@/features/usage/api';
import { OutcomesReport } from '@/features/usage/components/outcomes-report';

export const Route = createFileRoute('/_app/w/$workspaceId/usage/')({
  validateSearch: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    botId: z.string().optional(),
  }),
  component: function UsagePage() {
    const { workspaceId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const defaults = defaultUsageRange();
    const range = {
      from: search.from ?? defaults.from,
      to: search.to ?? defaults.to,
      ...(search.botId === undefined ? {} : { botId: search.botId }),
    };
    return (
      <OutcomesReport
        key={`${range.from}|${range.to}|${range.botId ?? ''}`}
        workspaceId={workspaceId}
        range={range}
        onRangeChange={(range) => {
          void navigate({
            search: {
              from: range.from,
              to: range.to,
              ...(range.botId === undefined ? {} : { botId: range.botId }),
            },
          });
        }}
      />
    );
  },
});
