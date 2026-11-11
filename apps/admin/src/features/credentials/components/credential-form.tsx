// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import {
  type CreateCredentialRequest,
  type CredentialDto,
  PROVIDER_KINDS,
  type ProviderKind,
} from '@app/shared';

import { useCreateCredential, useUpdateCredential } from '../api';

type CreatableProvider = Exclude<ProviderKind, 'local'>;

/** Providers whose credential carries an API key (spec §9.2). */
const KEY_PROVIDERS: readonly ProviderKind[] = [
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'mistral',
  'openai_compatible',
  'mock',
];

/** Providers reached at an admin-supplied endpoint. */
const BASE_URL_PROVIDERS: readonly ProviderKind[] = ['ollama', 'openai_compatible'];

/** `local` is provisioned by the platform, never created here. */
const CREATABLE = PROVIDER_KINDS.filter((kind): kind is CreatableProvider => kind !== 'local');

interface Props {
  workspaceId: string;
  /** The credential being edited; absent when creating. */
  credential?: CredentialDto;
  onDone?: () => void;
}

export function CredentialForm({ workspaceId, credential, onDone }: Props) {
  const isEdit = credential !== undefined;
  const [provider, setProvider] = useState<CreatableProvider>(
    credential === undefined || credential.provider === 'local' ? 'openai' : credential.provider,
  );
  const [label, setLabel] = useState(credential?.label ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(credential?.baseUrl ?? '');

  const create = useCreateCredential(workspaceId);
  const update = useUpdateCredential(workspaceId);
  const pending = create.isPending || update.isPending;
  const error = isEdit ? update.error : create.error;

  const takesKey = KEY_PROVIDERS.includes(provider);
  const takesBaseUrl = BASE_URL_PROVIDERS.includes(provider);
  // The keyed providers cannot be created without a key; `mock` and `openai_compatible` can.
  const keyRequired = provider !== 'mock' && provider !== 'openai_compatible';

  /** The discriminated union the API takes, built without a cast so a wrong field fails here. */
  function createRequest(): CreateCredentialRequest {
    switch (provider) {
      case 'ollama':
        return { provider, label, baseUrl };
      case 'openai_compatible':
        return { provider, label, baseUrl, ...(apiKey === '' ? {} : { apiKey }) };
      case 'mock':
        return { provider, label, ...(apiKey === '' ? {} : { apiKey }) };
      case 'openai':
      case 'anthropic':
      case 'gemini':
      case 'groq':
      case 'mistral':
        return { provider, label, apiKey };
    }
  }

  function submit(event: React.SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isEdit) {
      update.mutate(
        {
          credentialId: credential.id,
          // An untouched key field is omitted: the stored secret stays as it is.
          input: {
            label,
            ...(takesKey && apiKey !== '' ? { apiKey } : {}),
            ...(takesBaseUrl ? { baseUrl } : {}),
          },
        },
        { onSuccess: () => onDone?.() },
      );
      return;
    }

    create.mutate(createRequest(), { onSuccess: () => onDone?.() });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="credential-provider">{strings.credentials.provider}</Label>
        {isEdit ? (
          <p className="text-sm">{strings.credentials.providers[provider]}</p>
        ) : (
          <NativeSelect
            id="credential-provider"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as CreatableProvider);
            }}
          >
            {CREATABLE.map((kind) => (
              <option key={kind} value={kind}>
                {strings.credentials.providers[kind]}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="credential-label">{strings.credentials.label}</Label>
        <Input
          id="credential-label"
          value={label}
          required
          maxLength={80}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
        />
      </div>

      {takesKey ? (
        <div className="space-y-2">
          <Label htmlFor="credential-api-key">{strings.credentials.apiKey}</Label>
          <Input
            id="credential-api-key"
            type="password"
            autoComplete="off"
            required={!isEdit && keyRequired}
            value={apiKey}
            placeholder={
              isEdit && credential.secretLast4 !== null
                ? strings.credentials.apiKeyKeep(credential.secretLast4)
                : undefined
            }
            onChange={(event) => {
              setApiKey(event.target.value);
            }}
          />
          {isEdit ? (
            <p className="text-xs text-muted-foreground">{strings.credentials.apiKeyHint}</p>
          ) : null}
        </div>
      ) : null}

      {takesBaseUrl ? (
        <div className="space-y-2">
          <Label htmlFor="credential-base-url">{strings.credentials.baseUrl}</Label>
          <Input
            id="credential-base-url"
            type="url"
            value={baseUrl}
            required
            onChange={(event) => {
              setBaseUrl(event.target.value);
            }}
          />
        </div>
      ) : null}

      <FormAlert message={errorMessage(error)} />

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {isEdit ? strings.credentials.save : strings.credentials.create}
        </Button>
        {onDone === undefined ? null : (
          <Button type="button" variant="ghost" onClick={onDone}>
            {strings.credentials.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
