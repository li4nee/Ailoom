// SPDX-License-Identifier: AGPL-3.0-only

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { SIGNUP_MODES, type SignupMode } from '@app/shared';

import { useInstanceSettings, useUpdateInstanceSettings } from '../api';

function isSignupMode(value: string): value is SignupMode {
  return (SIGNUP_MODES as readonly string[]).includes(value);
}

export function InstanceSettingsPanel({ isInstanceAdmin }: { isInstanceAdmin: boolean }) {
  const settings = useInstanceSettings(isInstanceAdmin);
  const update = useUpdateInstanceSettings();

  if (!isInstanceAdmin) return <p>{strings.instance.notAllowed}</p>;
  if (settings.isError) return <FormAlert message={errorMessage(settings.error)} />;
  if (settings.data === undefined) return <Skeleton className="h-24 w-full max-w-md" />;

  return (
    <div className="max-w-md space-y-4">
      <div className="space-y-1">
        <Label htmlFor="signup-mode">{strings.instance.signupMode}</Label>
        <NativeSelect
          id="signup-mode"
          value={settings.data.signupMode}
          disabled={update.isPending}
          onChange={(event) => {
            const mode = event.target.value;
            if (isSignupMode(mode)) update.mutate({ signupMode: mode });
          }}
        >
          {SIGNUP_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {strings.instance.modes[mode]}
            </option>
          ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          {strings.instance.source[settings.data.signupModeSource]}
        </p>
      </div>
      <FormAlert message={errorMessage(update.error)} />
      {update.isSuccess ? <p role="status">{strings.instance.saved}</p> : null}
      <div>
        <h2 className="font-semibold">{strings.instance.email}</h2>
        <p className="text-sm">
          {settings.data.emailEnabled ? strings.instance.emailOn : strings.instance.emailOff}
        </p>
      </div>
    </div>
  );
}
