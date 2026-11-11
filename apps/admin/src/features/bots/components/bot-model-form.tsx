// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useCredentials, useModels } from '../../credentials/api';
import { useBot, useUpdateBot } from '../api';

const KNOWN_ERRORS = {
  reembed_not_available: strings.bots.reembedNotAvailable,
  embeddings_not_supported: strings.bots.embeddingNotSupported,
} as const;

export function BotModelForm({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const credentials = useCredentials(workspaceId, true);
  const update = useUpdateBot(workspaceId, botId);

  const [chatCredentialId, setChatCredentialId] = useState<string | null>(null);
  const [chatModel, setChatModel] = useState<string | null>(null);
  const [embeddingCredentialId, setEmbeddingCredentialId] = useState<string | null>(null);
  const [embeddingModel, setEmbeddingModel] = useState<string | null>(null);

  const data = bot.data;
  const chatSelection = chatCredentialId ?? data?.chatCredentialId ?? '';
  const embeddingSelection = embeddingCredentialId ?? data?.embeddingCredentialId ?? '';
  const chatModels = useModels(workspaceId, chatSelection, chatSelection !== '');
  const embeddingModels = useModels(workspaceId, embeddingSelection, embeddingSelection !== '');

  if (data === undefined) return <Skeleton className="h-24 w-full" />;

  return (
    <form
      className="max-w-lg space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          chatCredentialId: chatSelection,
          chatModel: chatModel ?? data.chatModel,
          embeddingCredentialId: embeddingSelection,
          embeddingModel: embeddingModel ?? data.embeddingModel,
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bot-chat-credential">{strings.bots.chatCredential}</Label>
        <NativeSelect
          id="bot-chat-credential"
          value={chatSelection}
          disabled={!isAdmin}
          onChange={(event) => {
            setChatCredentialId(event.target.value);
            setChatModel(null);
          }}
        >
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
          value={chatModel ?? data.chatModel}
          disabled={!isAdmin || chatModels.isPending}
          onChange={(event) => {
            setChatModel(event.target.value);
          }}
        >
          {(chatModels.data ?? [])
            .filter((model) => model.kind === 'chat')
            .map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-embedding-credential">{strings.bots.embeddingCredential}</Label>
        <NativeSelect
          id="bot-embedding-credential"
          value={embeddingSelection}
          disabled={!isAdmin}
          onChange={(event) => {
            setEmbeddingCredentialId(event.target.value);
            setEmbeddingModel(null);
          }}
        >
          {(credentials.data ?? []).map((credential) => (
            <option key={credential.id} value={credential.id}>
              {credential.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-embedding-model">{strings.bots.embeddingModel}</Label>
        <NativeSelect
          id="bot-embedding-model"
          value={embeddingModel ?? data.embeddingModel}
          disabled={!isAdmin || embeddingModels.isPending}
          onChange={(event) => {
            setEmbeddingModel(event.target.value);
          }}
        >
          {(embeddingModels.data ?? [])
            .filter((model) => model.kind === 'embedding')
            .map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
        </NativeSelect>
      </div>

      <FormAlert message={errorMessage(update.error, KNOWN_ERRORS)} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!isAdmin || update.isPending}>
          {strings.bots.save}
        </Button>
        {update.isSuccess ? (
          <span className="text-sm text-muted-foreground">{strings.bots.saved}</span>
        ) : null}
      </div>
    </form>
  );
}
