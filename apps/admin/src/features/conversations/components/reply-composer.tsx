// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { useSavedReplies } from '@/features/saved-replies/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { ConversationStatus } from '@app/shared';

import { useSendAgentMessage } from '../api';

export function ReplyComposer({
  workspaceId,
  conversationId,
  status,
  currentUserName,
}: {
  workspaceId: string;
  conversationId: string;
  status: ConversationStatus;
  currentUserName: string;
}) {
  const [content, setContent] = useState('');
  const send = useSendAgentMessage(workspaceId, conversationId);
  const savedReplies = useSavedReplies(workspaceId);
  const [savedReplyId, setSavedReplyId] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

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
    </form>
  );
}
