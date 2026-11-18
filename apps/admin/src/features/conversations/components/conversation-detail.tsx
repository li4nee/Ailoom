// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Label } from '@/components/ui/label';
import { useMe } from '@/features/auth/api';
import { useMembers } from '@/features/members/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { PRIORITIES } from '@app/shared';

import { useConversation, useSetConversationAssignment, useSetConversationPriority } from '../api';
import { ContactSidebar } from './contact-sidebar';
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
  const role = useWorkspaceRole();
  const canRoute = hasRole(role, 'admin');
  const members = useMembers(workspaceId, canRoute);
  const priorityMutation = useSetConversationPriority(workspaceId, conversationId);
  const assignmentMutation = useSetConversationAssignment(workspaceId, conversationId);

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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="min-w-0 space-y-4">
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
              <span>{strings.conversations.priorities[header.priority]}</span>
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

        <div className="flex items-center gap-2">
          <Label htmlFor="conversation-priority">{strings.conversations.priority}</Label>
          <NativeSelect
            id="conversation-priority"
            value={header.priority}
            disabled={priorityMutation.isPending}
            onChange={(event) => {
              priorityMutation.mutate({
                priority: event.target.value,
                expectedWorkflowVersion: header.workflowVersion,
                mutationId: crypto.randomUUID(),
              });
            }}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {strings.conversations.priorities[priority]}
              </option>
            ))}
          </NativeSelect>
          {priorityMutation.error ? (
            <span role="alert">{errorMessage(priorityMutation.error)}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="conversation-assignment">{strings.conversations.assigned}</Label>
          <NativeSelect
            id="conversation-assignment"
            value={header.assignedTo?.id ?? ''}
            disabled={
              assignmentMutation.isPending ||
              (!canRoute && owner !== null && owner.id !== me.data?.id)
            }
            onChange={(event) => {
              assignmentMutation.mutate({
                assignedUserId: event.target.value === '' ? null : event.target.value,
                expectedWorkflowVersion: header.workflowVersion,
                mutationId: crypto.randomUUID(),
              });
            }}
          >
            <option value="">{strings.conversations.unassigned}</option>
            {canRoute ? (
              (members.data ?? []).map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name ?? member.email}
                </option>
              ))
            ) : me.data === null || me.data === undefined ? null : (
              <option value={me.data.id}>{strings.conversations.me}</option>
            )}
          </NativeSelect>
          {assignmentMutation.error ? (
            <span role="alert">{errorMessage(assignmentMutation.error)}</span>
          ) : null}
        </div>

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
      </main>
      <ContactSidebar
        workspaceId={workspaceId}
        contact={contact}
        history={conversation.data.contactHistory}
      />
    </div>
  );
}
