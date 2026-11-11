// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { strings } from '@/strings';

export const Route = createFileRoute('/')({
  component: () => <main className="p-8">{strings.app.name}</main>,
});
