// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useDeleteAccount } from '../api';

export function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const remove = useDeleteAccount();
  const [password, setPassword] = useState('');

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{strings.account.deleteTitle}</h2>
      <p className="text-sm text-muted-foreground">{strings.account.deleteIntro}</p>
      <ConfirmDialog
        trigger={<Button variant="destructive">{strings.account.deleteAccount}</Button>}
        title={strings.account.deleteTitle}
        description={strings.account.deleteIntro}
        confirmLabel={strings.account.deleteAccount}
        error={errorMessage(remove.error, {
          sole_owner: strings.account.soleOwner,
          invalid_credentials: strings.account.wrongDeletePassword,
        })}
        pending={remove.isPending || password === ''}
        onConfirm={() => {
          remove.mutate(password, { onSuccess: onDeleted });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="delete-password">{strings.auth.password}</Label>
          <Input
            id="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </div>
      </ConfirmDialog>
    </section>
  );
}
