// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { DeleteAccount } from '@/features/account/components/delete-account';
import { PasswordForm } from '@/features/account/components/password-form';
import { ProfileForm } from '@/features/account/components/profile-form';
import { useMe } from '@/features/auth/api';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/account/')({
  component: AccountPage,
});

function AccountPage() {
  const me = useMe().data;
  if (me === undefined || me === null) return null;
  return (
    <main className="mx-auto max-w-3xl space-y-10 p-6">
      <h1 className="text-2xl font-semibold">{strings.account.title}</h1>
      <ProfileForm me={me} />
      <PasswordForm />
      <DeleteAccount
        onDeleted={() => {
          window.location.assign('/login');
        }}
      />
    </main>
  );
}
