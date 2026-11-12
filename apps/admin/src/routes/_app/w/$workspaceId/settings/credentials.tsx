// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { RoleGate } from '@/components/role-gate';
import { CredentialList } from '@/features/credentials/components/credential-list';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/credentials')({
  component: function CredentialsPage() {
    const { workspaceId } = Route.useParams();
    return (
      <RoleGate min="admin">
        <h2 className="sr-only">{strings.credentials.title}</h2>
        <CredentialList workspaceId={workspaceId} />
      </RoleGate>
    );
  },
});
