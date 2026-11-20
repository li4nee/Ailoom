// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { type InboxFilters, useConversations } from '../api';
import { StatusBadge } from './status-badge';

export function ConversationQueue({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const conversations = useConversations(workspaceId, { limit: 30 } satisfies InboxFilters);

  return (
    <aside className="hidden min-w-0 xl:block" aria-label={strings.conversations.title}>
      <header className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold">{strings.conversations.title}</h2>
        <Link
          to="/w/$workspaceId/conversations"
          params={{ workspaceId }}
          className="rounded text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {strings.conversations.open}
        </Link>
      </header>

      <div className="ledger-panel overflow-hidden">
        {conversations.isLoading ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">
            {strings.app.loading}
          </p>
        ) : conversations.data === undefined ? (
          <p className="p-3 text-sm text-destructive" role="alert">
            {errorMessage(conversations.error) ?? strings.conversations.detail.loadFailed}
          </p>
        ) : conversations.data.data.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">
            {strings.conversations.empty}
          </p>
        ) : (
          <nav
            className="max-h-[calc(100svh-14rem)] overflow-y-auto"
            aria-label={strings.conversations.title}
          >
            <ul className="divide-y divide-border">
              {conversations.data.data.map((conversation) => {
                const selected = conversation.id === conversationId;
                return (
                  <li key={conversation.id}>
                    <Link
                      to="/w/$workspaceId/conversations/$conversationId"
                      params={{ workspaceId, conversationId: conversation.id }}
                      aria-current={selected ? 'page' : undefined}
                      className="block min-w-0 space-y-2 px-3 py-3 text-sm transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-secondary"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {conversation.contact.name ??
                            conversation.contact.email ??
                            strings.conversations.detail.contact}
                        </span>
                        {conversation.priority === 'normal' ? null : (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {strings.conversations.priorities[conversation.priority]}
                          </span>
                        )}
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {conversation.lastMessagePreview}
                      </p>
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <StatusBadge status={conversation.status} />
                        <span className="truncate text-xs text-muted-foreground">
                          {conversation.assignedTo?.name ?? strings.conversations.unassigned}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </aside>
  );
}
