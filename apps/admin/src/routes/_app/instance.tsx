// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { useMe } from '@/features/auth/api';
import { DiagnosticsPanel } from '@/features/instance/components/diagnostics';
import { InstanceSettingsPanel } from '@/features/instance/components/instance-settings-panel';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/instance')({
  component: function InstancePage() {
    const me = useMe().data;
    return (
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">{strings.instance.title}</h1>
        <InstanceSettingsPanel isInstanceAdmin={me?.isInstanceAdmin === true} />
        <DiagnosticsPanel isInstanceAdmin={me?.isInstanceAdmin === true} />
      </main>
    );
  },
});
