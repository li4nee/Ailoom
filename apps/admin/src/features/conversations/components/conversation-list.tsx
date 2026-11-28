// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { strings } from '@/strings';
import type { ConversationListItem } from '@app/shared';

import type { InboxFilters } from '../api';
import { SlaIndicator } from './sla-indicator';
import { StatusBadge } from './status-badge';

function time(value: string): { label: string; exact: string } {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return {
    label: new Intl.DateTimeFormat(undefined, {
      ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
    exact: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date),
  };
}

export function ConversationList({
  workspaceId,
  conversations,
  filters,
}: {
  workspaceId: string;
  conversations: ConversationListItem[];
  filters: InboxFilters;
}) {
  if (conversations.length === 0) {
    const filtered = Object.entries(filters).some(
      ([key, value]) => key !== 'limit' && key !== 'cursor' && value !== undefined && value !== '',
    );
    return (
      <p
        role="status"
        className="rounded-md border border-dashed p-6 text-sm text-muted-foreground"
      >
        {filtered ? strings.conversations.emptyFilters : strings.conversations.empty}
      </p>
    );
  }

  return (
    <>
      <div className="ledger-panel overflow-hidden lg:hidden">
        <ul className="divide-y divide-border">
          {conversations.map((conversation) => {
            const timestamp = time(conversation.lastMessageAt);
            return (
              <li key={conversation.id}>
                <Link
                  className="flex min-h-24 flex-col gap-2 px-4 py-3 transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  to="/w/$workspaceId/conversations/$conversationId"
                  params={{ workspaceId, conversationId: conversation.id }}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {conversation.contact.name ??
                          conversation.contact.email ??
                          strings.conversations.detail.contact}
                      </p>
                      {conversation.contact.email === null ? null : (
                        <p className="truncate text-xs text-muted-foreground">
                          {conversation.contact.email}
                        </p>
                      )}
                    </div>
                    <time
                      dateTime={conversation.lastMessageAt}
                      title={timestamp.exact}
                      className="shrink-0 pt-0.5 text-xs text-muted-foreground"
                    >
                      {timestamp.label}
                    </time>
                  </div>

                  <p className="line-clamp-2 text-sm text-foreground/85">
                    {conversation.lastMessagePreview}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <StatusBadge status={conversation.status} />
                    {conversation.priority === 'normal' ? null : (
                      <span>{strings.conversations.priorities[conversation.priority]}</span>
                    )}
                    <span className="min-w-0 truncate">{conversation.botName}</span>
                    <span className="min-w-0 truncate">
                      {conversation.assignedTo?.name ?? strings.conversations.unassigned}
                    </span>
                    <SlaIndicator sla={conversation.sla} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <DesktopConversationTable workspaceId={workspaceId} conversations={conversations} />
    </>
  );
}

function DesktopConversationTable({
  workspaceId,
  conversations,
}: {
  workspaceId: string;
  conversations: ConversationListItem[];
}) {
  return (
    <div className="ledger-panel hidden overflow-hidden lg:block">
      <Table>
        <TableHeader className="bg-secondary/70">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[27%]">{strings.conversations.title}</TableHead>
            <TableHead>{strings.conversations.bot}</TableHead>
            <TableHead className="w-32">{strings.conversations.status}</TableHead>
            <TableHead>{strings.conversations.assigned}</TableHead>
            <TableHead>{strings.conversations.priority}</TableHead>
            <TableHead>{strings.conversations.lastMessage}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {conversations.map((conversation) => {
            const timestamp = time(conversation.lastMessageAt);
            return (
              <TableRow key={conversation.id} className="group">
                <TableCell className="max-w-64 whitespace-normal">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      className="min-w-0 font-semibold text-foreground underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                      to="/w/$workspaceId/conversations/$conversationId"
                      params={{ workspaceId, conversationId: conversation.id }}
                    >
                      {conversation.contact.name ?? conversation.contact.email ?? conversation.id}
                    </Link>
                    {conversation.unansweredByHuman ? (
                      <Badge variant="destructive">{strings.conversations.needsHuman}</Badge>
                    ) : null}
                  </div>
                  {conversation.contact.email === null ? null : (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {conversation.contact.email}
                    </p>
                  )}
                  <div className="mt-2">
                    <SlaIndicator sla={conversation.sla} />
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                  {conversation.botName}
                </TableCell>
                <TableCell>
                  <StatusBadge status={conversation.status} />
                </TableCell>
                <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                  {conversation.assignedTo?.name ?? strings.conversations.unassigned}
                </TableCell>
                <TableCell>{strings.conversations.priorities[conversation.priority]}</TableCell>
                <TableCell className="max-w-96 whitespace-normal">
                  <time
                    dateTime={conversation.lastMessageAt}
                    title={timestamp.exact}
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    {timestamp.label}
                  </time>
                  <p className="line-clamp-2 text-sm text-foreground/85">
                    {conversation.lastMessagePreview}
                  </p>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
