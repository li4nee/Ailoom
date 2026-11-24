// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Label } from '@/components/ui/label';
import { useMe } from '@/features/auth/api';
import { useMembers } from '@/features/members/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { PRIORITIES } from '@app/shared';

import {
  useConversation,
  useRegenerateHandoffSummary,
  useSetConversationAssignment,
  useSetConversationPriority,
} from '../api';
import { ContactSidebar } from './contact-sidebar';
import { ConversationActions } from './conversation-actions';
import { ConversationQueue } from './conversation-queue';
import { InternalNotes } from './internal-notes';
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
  const summaryMutation = useRegenerateHandoffSummary(workspaceId, conversationId);

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
    <div className="grid items-start gap-6 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <ConversationQueue workspaceId={workspaceId} conversationId={conversationId} />
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="min-w-0 space-y-5">
          <Link
            to="/w/$workspaceId/conversations"
            params={{ workspaceId }}
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {strings.conversations.detail.back}
          </Link>

          <header className="ledger-panel flex flex-wrap items-center justify-between gap-5 p-5">
            <div className="space-y-1">
              <h1 className="ledger-heading text-2xl">
                {contact.name ?? contact.email ?? strings.conversations.detail.contact}
              </h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
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

          <div className="ledger-panel grid gap-4 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="conversation-priority">{strings.conversations.priority}</Label>
              <NativeSelect
                id="conversation-priority"
                className="w-full"
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

            <div className="space-y-2">
              <Label htmlFor="conversation-assignment">{strings.conversations.assigned}</Label>
              <NativeSelect
                id="conversation-assignment"
                className="w-full"
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
          </div>

          {ownedByOther ? (
            <FormAlert message={strings.conversations.detail.alreadyAssigned(owner.name)} />
          ) : null}

          {conversation.data.handoffSummaryEnabled || conversation.data.handoffSummary !== null ? (
            <section className="space-y-3 border-y border-border py-4">
              <h2 className="ledger-heading">Handoff summary</h2>
              {conversation.data.handoffSummary?.state === 'ready' &&
              conversation.data.handoffSummary.content !== null ? (
                <div className="space-y-2 text-sm">
                  {conversation.data.handoffSummary.sourceThroughMessageId !==
                  messages.at(-1)?.id ? (
                    <p role="status">This summary may be out of date.</p>
                  ) : null}
                  <p>
                    <strong>Issue:</strong> {conversation.data.handoffSummary.content.issue}
                  </p>
                  {conversation.data.handoffSummary.content.actionsAttempted.length > 0 ? (
                    <p>
                      <strong>Actions tried:</strong>{' '}
                      {conversation.data.handoffSummary.content.actionsAttempted.join('; ')}
                    </p>
                  ) : null}
                  {conversation.data.handoffSummary.content.customerFacts.length > 0 ? (
                    <p>
                      <strong>Customer facts:</strong>{' '}
                      {conversation.data.handoffSummary.content.customerFacts.join('; ')}
                    </p>
                  ) : null}
                  {conversation.data.handoffSummary.content.sentimentUrgency.length > 0 ? (
                    <p>
                      <strong>Signals:</strong>{' '}
                      {conversation.data.handoffSummary.content.sentimentUrgency.join('; ')}
                    </p>
                  ) : null}
                  {conversation.data.handoffSummary.content.unresolvedQuestion === null ? null : (
                    <p>
                      <strong>Open question:</strong>{' '}
                      {conversation.data.handoffSummary.content.unresolvedQuestion}
                    </p>
                  )}
                </div>
              ) : conversation.data.handoffSummary?.state === 'queued' ||
                conversation.data.handoffSummary?.state === 'running' ? (
                <p role="status">Summary is being generated.</p>
              ) : conversation.data.handoffSummary?.state === 'failed' ? (
                <p role="status">Summary is unavailable. You can retry.</p>
              ) : (
                <p className="text-sm text-muted-foreground">No handoff summary yet.</p>
              )}
              {conversation.data.handoffSummaryEnabled ? (
                <button
                  type="button"
                  className="mt-3 rounded border px-3 py-1.5 text-sm"
                  disabled={
                    summaryMutation.isPending ||
                    ['queued', 'running'].includes(conversation.data.handoffSummary?.state ?? '')
                  }
                  onClick={() => {
                    summaryMutation.mutate();
                  }}
                >
                  {summaryMutation.isPending ? 'Requesting…' : 'Regenerate summary'}
                </button>
              ) : null}
              {summaryMutation.error ? (
                <p role="alert">{errorMessage(summaryMutation.error)}</p>
              ) : null}
            </section>
          ) : null}

          <section className="ledger-panel overflow-hidden p-4 sm:p-5">
            <MessageTimeline
              messages={messages}
              workspaceId={workspaceId}
              conversationId={conversationId}
            />
            <InternalNotes workspaceId={workspaceId} conversationId={conversationId} role={role} />
          </section>

          <section className="ledger-panel p-4 sm:p-5">
            <ReplyComposer
              workspaceId={workspaceId}
              conversationId={conversationId}
              status={header.status}
              currentUserName={currentUserName}
              latestMessageId={messages.at(-1)?.id ?? null}
              suggestedRepliesEnabled={conversation.data.suggestedRepliesEnabled}
              existingSuggestion={conversation.data.suggestedReply}
            />
          </section>
        </section>
        <ContactSidebar
          workspaceId={workspaceId}
          contact={contact}
          history={conversation.data.contactHistory}
          crmLinks={conversation.data.crmLinks}
        />
      </div>
    </div>
  );
}
