// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { CreateWorkspaceForm } from '@/features/workspaces/components/create-workspace-form';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/new-workspace')({
  component: NewWorkspacePage,
});

function NewWorkspacePage() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{strings.workspaces.createTitle}</h1>
      <p className="text-muted-foreground">{strings.workspaces.createIntro}</p>
      <CreateWorkspaceForm
        onCreated={(workspaceId) =>
          void navigate({ to: '/w/$workspaceId', params: { workspaceId } })
        }
      />
    </main>
  );
}
