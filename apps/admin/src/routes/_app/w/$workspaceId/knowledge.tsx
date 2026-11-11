// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { ComingSoon } from '@/components/coming-soon';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/knowledge')({
  component: () => <ComingSoon title={strings.nav.knowledge} />,
});
