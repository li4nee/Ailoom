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

function time(value: string): string {
  return new Date(value).toLocaleString();
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{strings.conversations.title}</TableHead>
          <TableHead>{strings.conversations.bot}</TableHead>
          <TableHead>{strings.conversations.status}</TableHead>
          <TableHead>{strings.conversations.assigned}</TableHead>
          <TableHead>{strings.conversations.priority}</TableHead>
          <TableHead>{strings.conversations.lastMessage}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {conversations.map((conversation) => (
          <TableRow key={conversation.id}>
            <TableCell>
              <Link
                className="font-medium underline-offset-2 hover:underline"
                to="/w/$workspaceId/conversations/$conversationId"
                params={{ workspaceId, conversationId: conversation.id }}
              >
                {conversation.contact.name ?? conversation.contact.email ?? conversation.id}
              </Link>
              {conversation.unansweredByHuman ? (
                <Badge className="ml-2" variant="destructive">
                  {strings.conversations.needsHuman}
                </Badge>
              ) : null}
            </TableCell>
            <TableCell>{conversation.botName}</TableCell>
            <TableCell>
              <StatusBadge status={conversation.status} />
            </TableCell>
            <TableCell>
              {conversation.assignedTo?.name ?? strings.conversations.unassigned}
            </TableCell>
            <TableCell>{strings.conversations.priorities[conversation.priority]}</TableCell>
            <TableCell className="max-w-96 truncate whitespace-normal">
              <span className="text-muted-foreground">{time(conversation.lastMessageAt)}</span>{' '}
              {conversation.lastMessagePreview}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
