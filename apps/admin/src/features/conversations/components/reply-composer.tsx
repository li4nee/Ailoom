// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
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
        <Button type="submit" disabled={send.isPending || content.trim() === ''}>
          {strings.conversations.detail.send}
        </Button>
        <FormAlert message={errorMessage(send.error)} />
      </div>
    </form>
  );
}
