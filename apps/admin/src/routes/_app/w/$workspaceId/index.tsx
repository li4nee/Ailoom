// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/')({
  component: () => (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{strings.workspaces.overview}</h1>
      <p className="text-muted-foreground">{strings.workspaces.overviewIntro}</p>
    </section>
  ),
});
