// SPDX-License-Identifier: AGPL-3.0-only
import { MarkdownView } from '@/features/playground/components/markdown-view';
import { TraceDrawer } from '@/features/traces/components/trace-drawer';
import { strings } from '@/strings';
import { isSafeHref, parseMarkdownSubset, type AdminMessage, type Citation } from '@app/shared';

function label(message: AdminMessage): string {
  switch (message.role) {
    case 'system':
      return strings.conversations.detail.system;
    case 'agent':
      return message.author?.name ?? strings.conversations.detail.agent;
    case 'visitor':
      return strings.conversations.detail.visitor;
    case 'ai':
      return strings.conversations.detail.ai;
  }
}

function CitationLink({ citation }: { citation: Citation }) {
  if (citation.url !== null && isSafeHref(citation.url)) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline underline-offset-2"
      >
        {citation.title}
      </a>
    );
  }
  return <>{citation.title}</>;
}

function Citations({ message }: { message: AdminMessage }) {
  if (message.citations === null || message.citations.length === 0) return null;
  return (
    <div className="mt-2 border-t pt-2">
      <p className="text-xs font-medium text-muted-foreground">
        {strings.conversations.detail.sources}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-xs">
        {message.citations.map((citation) => (
          <li key={citation.chunkId}>
            <CitationLink citation={citation} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Message({ message, workspaceId }: { message: AdminMessage; workspaceId: string }) {
  if (message.role === 'system') {
    return (
      <article>
        <p className="text-center text-xs text-muted-foreground" role="note">
          {message.content}
        </p>
      </article>
    );
  }

  const own = message.role === 'agent';
  return (
    <article className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg border px-3 py-2 ${
          own ? 'bg-primary/5' : 'bg-muted/40'
        }`}
      >
        <header className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{label(message)}</span>
          <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
        </header>
        {message.role === 'visitor' ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownView nodes={parseMarkdownSubset(message.content)} />
        )}
        <Citations message={message} />
        {message.feedback === null ? null : (
          <p className="mt-2 text-xs text-muted-foreground">
            {message.feedback === 1
              ? strings.conversations.detail.helpful
              : strings.conversations.detail.notHelpful}
          </p>
        )}
        {message.traceId === null ? null : (
          <div className="mt-1">
            <TraceDrawer workspaceId={workspaceId} traceId={message.traceId} />
          </div>
        )}
      </div>
    </article>
  );
}

export function MessageTimeline({
  messages,
  workspaceId,
}: {
  messages: AdminMessage[];
  workspaceId: string;
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">{strings.conversations.detail.empty}</p>;
  }
  return (
    <div className="space-y-3" role="feed" aria-label={strings.conversations.title}>
      {messages.map((message) => (
        <Message key={message.id} message={message} workspaceId={workspaceId} />
      ))}
    </div>
  );
}
