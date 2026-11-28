// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MarkdownView } from '@/features/playground/components/markdown-view';
import { TraceDrawer } from '@/features/traces/components/trace-drawer';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { isSafeHref, parseMarkdownSubset, type AdminMessage, type Citation } from '@app/shared';

import { useReviewAnswer } from '../api';

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

function ReviewAnswer({
  message,
  workspaceId,
  conversationId,
  question,
}: {
  message: AdminMessage;
  workspaceId: string;
  conversationId: string;
  question: string;
}) {
  const role = useWorkspaceRole();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(message.content);
  const [editedQuestion, setEditedQuestion] = useState(question);
  const mutation = useReviewAnswer(workspaceId, conversationId, message.id);
  const review = message.agentReview;
  const submit = (verdict: 'correct' | 'incorrect') => {
    mutation.mutate(
      verdict === 'correct' ? { verdict } : { verdict, question: editedQuestion, answer },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };
  if (!hasRole(role, 'agent')) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {review ? (
        <span className="text-xs text-muted-foreground">
          {review.verdict === 'correct'
            ? strings.conversations.detail.markedCorrect
            : `${strings.conversations.detail.markedIncorrect}${review.suggestionId ? ` · ${strings.conversations.detail.pendingReview}` : ''}`}
        </span>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            {strings.conversations.detail.reviewAnswer}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{strings.conversations.detail.reviewAnswer}</DialogTitle>
            <DialogDescription>{strings.conversations.detail.reviewHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`review-question-${message.id}`}>{strings.knowledge.question}</Label>
            <textarea
              id={`review-question-${message.id}`}
              className="min-h-20 w-full rounded-md border border-input bg-transparent p-3 text-sm"
              maxLength={1000}
              value={editedQuestion}
              onChange={(event) => {
                setEditedQuestion(event.target.value);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`review-answer-${message.id}`}>{strings.knowledge.answer}</Label>
            <textarea
              id={`review-answer-${message.id}`}
              className="min-h-32 w-full rounded-md border border-input bg-transparent p-3 text-sm"
              maxLength={4000}
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value);
              }}
            />
          </div>
          <FormAlert message={mutation.isError ? errorMessage(mutation.error) : null} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {strings.knowledge.cancel}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                submit('correct');
              }}
            >
              {strings.conversations.detail.markCorrect}
            </Button>
            <Button
              type="button"
              disabled={mutation.isPending || editedQuestion.trim() === '' || answer.trim() === ''}
              onClick={() => {
                submit('incorrect');
              }}
            >
              {strings.conversations.detail.markIncorrect}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Message({
  message,
  workspaceId,
  conversationId,
  question,
}: {
  message: AdminMessage;
  workspaceId: string;
  conversationId: string;
  question: string;
}) {
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
        className={`min-w-0 max-w-[95%] rounded-lg border px-3 py-2.5 [overflow-wrap:anywhere] sm:max-w-[85%] ${
          own ? 'bg-primary/5' : 'bg-muted/40'
        }`}
      >
        <header className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
        {message.role === 'ai' && message.status === 'complete' ? (
          <ReviewAnswer
            message={message}
            workspaceId={workspaceId}
            conversationId={conversationId}
            question={question}
          />
        ) : null}
      </div>
    </article>
  );
}

export function MessageTimeline({
  messages,
  workspaceId,
  conversationId,
}: {
  messages: AdminMessage[];
  workspaceId: string;
  conversationId: string;
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">{strings.conversations.detail.empty}</p>;
  }
  return (
    <div className="space-y-3" role="feed" aria-label={strings.conversations.title}>
      {messages.map((message, index) => {
        const question =
          messages
            .slice(0, index)
            .reverse()
            .find((item) => item.role === 'visitor')?.content ?? '';
        return (
          <Message
            key={message.id}
            message={message}
            workspaceId={workspaceId}
            conversationId={conversationId}
            question={question}
          />
        );
      })}
    </div>
  );
}
