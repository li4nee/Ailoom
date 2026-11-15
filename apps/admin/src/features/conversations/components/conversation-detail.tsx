// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

import { FormAlert } from '@/components/form-alert';
import { useMe } from '@/features/auth/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useConversation } from '../api';
import { ConversationActions } from './conversation-actions';
import { MessageTimeline } from './message-timeline';
import { ReplyComposer } from './reply-composer';
import { StatusBadge } from './status-badge';

export function ConversationDetail({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const conversation = useConversation(workspaceId, conversationId);
  const me = useMe();

  if (conversation.isLoading) {
    return <p role="status">{strings.app.loading}</p>;
  }

  if (conversation.data === undefined) {
    return (
      <div className="space-y-3">
        <Link
          to="/w/$workspaceId/conversations"
          params={{ workspaceId }}
          className="text-sm underline underline-offset-2"
        >
          {strings.conversations.detail.back}
        </Link>
        <FormAlert
          message={errorMessage(conversation.error) ?? strings.conversations.detail.loadFailed}
        />
      </div>
    );
  }

  const { conversation: header, contact, messages } = conversation.data;
  const owner = header.assignedTo;
  const ownedByOther =
    owner !== null && me.data !== null && me.data !== undefined && owner.id !== me.data.id;
  const currentUserName = me.data?.name ?? strings.conversations.me;

  return (
    <div className="max-w-4xl space-y-4">
      <Link
        to="/w/$workspaceId/conversations"
        params={{ workspaceId }}
        className="text-sm underline underline-offset-2"
      >
        {strings.conversations.detail.back}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {contact.name ?? contact.email ?? strings.conversations.detail.contact}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{header.botName}</span>
            <StatusBadge status={header.status} />
            {owner === null ? null : (
              <span>{strings.conversations.detail.assignedTo(owner.name)}</span>
            )}
          </p>
          {contact.email === null ? null : (
            <p className="text-sm text-muted-foreground">{contact.email}</p>
          )}
        </div>
        <ConversationActions
          workspaceId={workspaceId}
          conversationId={conversationId}
          conversation={header}
        />
      </header>

      {ownedByOther ? (
        <FormAlert message={strings.conversations.detail.alreadyAssigned(owner.name)} />
      ) : null}

      <section className="rounded-lg border p-4">
        <MessageTimeline messages={messages} workspaceId={workspaceId} />
      </section>

      <section className="rounded-lg border p-4">
        <ReplyComposer
          workspaceId={workspaceId}
          conversationId={conversationId}
          status={header.status}
          currentUserName={currentUserName}
        />
      </section>
    </div>
  );
}
