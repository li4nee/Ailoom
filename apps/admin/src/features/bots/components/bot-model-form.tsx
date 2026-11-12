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
import type { BotDto, UpdateBotRequest } from '@app/shared';

import { useCredentials, useModels } from '../../credentials/api';
import { useBot, useUpdateBot } from '../api';

const KNOWN_ERRORS = {
  reembed_not_available: strings.bots.reembedNotAvailable,
  embeddings_not_supported: strings.bots.embeddingNotSupported,
} as const;

/**
 * The model a select shows: the admin's pick, else the stored model while the credential is
 * unchanged. After a credential switch the stored model belongs to another provider, so the
 * select is empty until the admin picks one.
 */
function modelSelection(picked: string | null, credentialChanged: boolean, stored: string): string {
  return picked ?? (credentialChanged ? '' : stored);
}

export function BotModelForm({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);

  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  if (bot.data === undefined) return <Skeleton className="h-24 w-full" />;
  // Credentials and their model lists are admin-only endpoints; an agent sees the stored models.
  if (!isAdmin) return <BotModelSummary bot={bot.data} />;
  return <BotModelEditor workspaceId={workspaceId} botId={botId} data={bot.data} />;
}

function BotModelSummary({ bot }: { bot: BotDto }) {
  return (
    <div className="max-w-lg space-y-4">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium">{strings.bots.chatModel}</dt>
          <dd className="text-muted-foreground">{bot.chatModel}</dd>
        </div>
        <div>
          <dt className="font-medium">{strings.bots.embeddingModel}</dt>
          <dd className="text-muted-foreground">{bot.embeddingModel}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{strings.bots.agentsReadOnly}</p>
    </div>
  );
}

function BotModelEditor({
  workspaceId,
  botId,
  data,
}: {
  workspaceId: string;
  botId: string;
  data: BotDto;
}) {
  const credentials = useCredentials(workspaceId, true);
  const update = useUpdateBot(workspaceId, botId);

  const [chatCredentialId, setChatCredentialId] = useState<string | null>(null);
  const [chatModel, setChatModel] = useState<string | null>(null);
  const [embeddingCredentialId, setEmbeddingCredentialId] = useState<string | null>(null);
  const [embeddingModel, setEmbeddingModel] = useState<string | null>(null);
  const [missingModel, setMissingModel] = useState(false);

  const chatSelection = chatCredentialId ?? data.chatCredentialId;
  const embeddingSelection = embeddingCredentialId ?? data.embeddingCredentialId;
  const chatCredentialChanged = chatSelection !== data.chatCredentialId;
  const embeddingCredentialChanged = embeddingSelection !== data.embeddingCredentialId;
  const chatModelSelection = modelSelection(chatModel, chatCredentialChanged, data.chatModel);
  const embeddingModelSelection = modelSelection(
    embeddingModel,
    embeddingCredentialChanged,
    data.embeddingModel,
  );
  const chatModels = useModels(workspaceId, chatSelection, chatSelection !== '');
  const embeddingModels = useModels(workspaceId, embeddingSelection, embeddingSelection !== '');

  if (credentials.isError) return <FormAlert message={errorMessage(credentials.error)} />;

  return (
    <form
      className="max-w-lg space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (chatModelSelection === '' || embeddingModelSelection === '') {
          setMissingModel(true);
          return;
        }
        setMissingModel(false);
        // Only what changed: resending the stored embedding pair would read as a re-embed on a
        // bot that already has knowledge, and the API refuses that.
        const body: UpdateBotRequest = {};
        if (chatCredentialChanged) body.chatCredentialId = chatSelection;
        if (chatModelSelection !== data.chatModel) body.chatModel = chatModelSelection;
        if (embeddingCredentialChanged) body.embeddingCredentialId = embeddingSelection;
        if (embeddingModelSelection !== data.embeddingModel) {
          body.embeddingModel = embeddingModelSelection;
        }
        update.mutate(body);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bot-chat-credential">{strings.bots.chatCredential}</Label>
        <NativeSelect
          id="bot-chat-credential"
          value={chatSelection}
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
          value={chatModelSelection}
          disabled={chatModels.isPending}
          onChange={(event) => {
            setChatModel(event.target.value);
          }}
        >
          {chatModelSelection === '' ? <option value="">{strings.bots.pickModel}</option> : null}
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
          value={embeddingModelSelection}
          disabled={embeddingModels.isPending}
          onChange={(event) => {
            setEmbeddingModel(event.target.value);
          }}
        >
          {embeddingModelSelection === '' ? (
            <option value="">{strings.bots.pickModel}</option>
          ) : null}
          {(embeddingModels.data ?? [])
            .filter((model) => model.kind === 'embedding')
            .map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
        </NativeSelect>
      </div>

      <FormAlert
        message={missingModel ? strings.bots.pickModel : errorMessage(update.error, KNOWN_ERRORS)}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={update.isPending}>
          {strings.bots.save}
        </Button>
        {update.isSuccess ? (
          <span className="text-sm text-muted-foreground">{strings.bots.saved}</span>
        ) : null}
      </div>
    </form>
  );
}
