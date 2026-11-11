// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { BotDto, CredentialModel } from '@app/shared';

import { useCredentials, useModels } from '../../credentials/api';
import { useCreateBot } from '../api';

const KNOWN_ERRORS = {
  embeddings_not_supported: strings.bots.embeddingNotSupported,
} as const;

/** Create a bot: pick the chat credential first, then one of its chat models. */
export function BotCreateForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  /** Where to go next; the route navigates, so the form needs no router of its own. */
  onCreated: (bot: BotDto) => void;
}) {
  const credentials = useCredentials(workspaceId, true);
  const create = useCreateBot(workspaceId);

  const [name, setName] = useState('');
  const [chatCredentialId, setChatCredentialId] = useState('');
  const [chatModel, setChatModel] = useState('');

  const models = useModels(workspaceId, chatCredentialId, chatCredentialId !== '');
  const chatModels: CredentialModel[] = (models.data ?? []).filter(
    (model) => model.kind === 'chat',
  );

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ name, chatCredentialId, chatModel }, { onSuccess: onCreated });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bot-name">{strings.bots.name}</Label>
        <Input
          id="bot-name"
          value={name}
          required
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-chat-credential">{strings.bots.chatCredential}</Label>
        <NativeSelect
          id="bot-chat-credential"
          value={chatCredentialId}
          required
          onChange={(event) => {
            setChatCredentialId(event.target.value);
            setChatModel('');
          }}
        >
          <option value="">{strings.bots.pickCredential}</option>
          {(credentials.data ?? []).map((credential) => (
            <option key={credential.id} value={credential.id}>
              {credential.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-chat-model">{strings.bots.chatModel}</Label>
        <NativeSelect
          id="bot-chat-model"
          value={chatModel}
          required
          disabled={chatCredentialId === '' || models.isPending}
          onChange={(event) => {
            setChatModel(event.target.value);
          }}
        >
          <option value="">
            {chatModels.length === 0 && chatCredentialId !== ''
              ? strings.bots.noModels
              : strings.bots.pickModel}
          </option>
          {chatModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </NativeSelect>
      </div>

      <FormAlert message={errorMessage(credentials.error) ?? errorMessage(models.error)} />
      <FormAlert message={errorMessage(create.error, KNOWN_ERRORS)} />

      <Button type="submit" disabled={create.isPending}>
        {strings.bots.create}
      </Button>
    </form>
  );
}
