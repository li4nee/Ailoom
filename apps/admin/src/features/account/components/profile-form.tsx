// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { MeResponse } from '@app/shared';

import { useUpdateMe } from '../api';

export function ProfileForm({ me }: { me: MeResponse }) {
  const update = useUpdateMe();
  const [name, setName] = useState(me.name ?? '');

  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== '') update.mutate({ name: name.trim() });
      }}
    >
      <h2 className="text-lg font-semibold">{strings.account.profile}</h2>
      <div className="space-y-1">
        <Label htmlFor="profile-email">{strings.auth.email}</Label>
        <Input id="profile-email" value={me.email} readOnly />
      </div>
      <div className="space-y-1">
        <Label htmlFor="profile-name">{strings.members.name}</Label>
        <Input
          id="profile-name"
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <FormAlert message={errorMessage(update.error)} />
      {update.isSuccess ? <p role="status">{strings.account.saved}</p> : null}
      <Button type="submit" disabled={update.isPending}>
        {strings.account.save}
      </Button>
    </form>
  );
}
