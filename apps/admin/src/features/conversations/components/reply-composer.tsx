// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { useSavedReplies } from '@/features/saved-replies/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { ConversationStatus } from '@app/shared';
import type { SuggestedReplyArtifact } from '@app/shared';

import { useSendAgentMessage, useSuggestReply } from '../api';

export function ReplyComposer({
  workspaceId,
  conversationId,
  status,
  currentUserName,
  latestMessageId,
  suggestedRepliesEnabled,
  existingSuggestion,
}: {
  workspaceId: string;
  conversationId: string;
  status: ConversationStatus;
  currentUserName: string;
  latestMessageId: string | null;
  suggestedRepliesEnabled: boolean;
  existingSuggestion: SuggestedReplyArtifact | null;
}) {
  const [content, setContent] = useState('');
  const send = useSendAgentMessage(workspaceId, conversationId);
  const savedReplies = useSavedReplies(workspaceId);
  const suggestion = useSuggestReply(workspaceId, conversationId);
  const [savedReplyId, setSavedReplyId] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const suggested = suggestion.data ?? existingSuggestion;
  const stale = suggested !== null && suggested.sourceThroughMessageId !== latestMessageId;

  const submit = (): void => {
    const body = content.trim();
    if (body === '' || send.isPending) return;
    send.mutate(body, {
      onSuccess: () => {
        setContent('');
        input.current?.focus();
      },
    });
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {status === 'closed' ? (
        <p className="text-xs text-muted-foreground">{strings.conversations.detail.closed}</p>
      ) : status === 'human' ? null : (
        <p className="text-xs text-muted-foreground">
          {strings.conversations.detail.sendingAs(currentUserName)}
        </p>
      )}
      <label className="sr-only" htmlFor="reply-content">
        {strings.conversations.detail.composer}
      </label>
      <textarea
        id="reply-content"
        ref={input}
        value={content}
        rows={3}
        placeholder={strings.conversations.detail.composerPlaceholder}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onChange={(event) => {
          setContent(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center gap-3">
        {suggestedRepliesEnabled ? (
          <Button
            type="button"
            variant="outline"
            disabled={suggestion.isPending || latestMessageId === null}
            onClick={() => {
              suggestion.mutate();
            }}
          >
            {suggestion.isPending
              ? strings.conversations.detail.suggesting
              : strings.conversations.detail.suggestReply}
          </Button>
        ) : null}
        <NativeSelect
          aria-label={strings.conversations.detail.savedReplies}
          value={savedReplyId}
          onChange={(event) => {
            setSavedReplyId(event.target.value);
          }}
        >
          <option value="">{strings.conversations.detail.chooseSavedReply}</option>
          {(savedReplies.data ?? []).map((reply) => (
            <option key={reply.id} value={reply.id}>
              {reply.title}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="outline"
          disabled={savedReplyId === ''}
          onClick={() => {
            const reply = savedReplies.data?.find((candidate) => candidate.id === savedReplyId);
            if (reply === undefined) return;
            if (content.trim() !== '' && !window.confirm(strings.conversations.detail.replaceDraft))
              return;
            setContent(reply.body);
            input.current?.focus();
          }}
        >
          {strings.conversations.detail.insertSavedReply}
        </Button>
        <Button type="submit" disabled={send.isPending || content.trim() === ''}>
          {strings.conversations.detail.send}
        </Button>
        <FormAlert message={errorMessage(send.error)} />
      </div>
      {suggestion.error ? <FormAlert message={errorMessage(suggestion.error)} /> : null}
      {suggested?.state === 'running' ? (
        <p role="status">{strings.conversations.detail.suggestionRunning}</p>
      ) : null}
      {suggested?.state === 'failed' ? (
        <p role="status">{strings.conversations.detail.suggestionFailed}</p>
      ) : null}
      {suggested?.state === 'ready' && suggested.content !== null ? (
        <section
          className="space-y-2 rounded-md border p-3"
          aria-label={strings.conversations.detail.suggestedReply}
        >
          {stale ? <p role="status">{strings.conversations.detail.suggestionStale}</p> : null}
          {suggested.content.insufficientContext ? (
            <p role="status">{strings.conversations.detail.suggestionInsufficient}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm">{suggested.content.draft}</p>
              {suggested.content.citations.length > 0 ? (
                <ul className="list-inside list-disc text-xs">
                  {suggested.content.citations.map((citation) => (
                    <li key={citation.chunkId}>
                      {citation.url === null || !isSafeSourceUrl(citation.url) ? (
                        citation.title
                      ) : (
                        <a
                          className="underline"
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {citation.title}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={suggested.content.draft === ''}
                onClick={() => {
                  if (stale && !window.confirm(strings.conversations.detail.confirmStaleSuggestion))
                    return;
                  if (
                    !stale &&
                    content.trim() !== '' &&
                    !window.confirm(strings.conversations.detail.replaceDraft)
                  )
                    return;
                  setContent(suggested.content?.draft ?? '');
                  input.current?.focus();
                }}
              >
                {stale
                  ? strings.conversations.detail.useStaleSuggestion
                  : strings.conversations.detail.insertSuggestion}
              </Button>
            </>
          )}
        </section>
      ) : null}
    </form>
  );
}

function isSafeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
