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
    <div className="ledger-panel overflow-hidden">
      <Table>
        <TableHeader className="bg-secondary/70">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[27%]">{strings.conversations.title}</TableHead>
            <TableHead className="hidden md:table-cell">{strings.conversations.bot}</TableHead>
            <TableHead className="w-32">{strings.conversations.status}</TableHead>
            <TableHead className="hidden md:table-cell">{strings.conversations.assigned}</TableHead>
            <TableHead className="hidden md:table-cell">{strings.conversations.priority}</TableHead>
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
                      className="font-semibold text-foreground underline-offset-4 hover:underline"
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
                </TableCell>
                <TableCell className="hidden md:table-cell">{conversation.botName}</TableCell>
                <TableCell>
                  <StatusBadge status={conversation.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {conversation.assignedTo?.name ?? strings.conversations.unassigned}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {strings.conversations.priorities[conversation.priority]}
                </TableCell>
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
