// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { KnowledgeSuggestionDto, SuggestionStatus } from '@app/shared';

import { useDecideSuggestion, useKnowledgeSuggestions } from '../api';

function SuggestionActions({
  workspaceId,
  suggestion,
}: {
  workspaceId: string;
  suggestion: KnowledgeSuggestionDto;
}) {
  const [title, setTitle] = useState(`Correction: ${suggestion.question.slice(0, 80)}`);
  const [question, setQuestion] = useState(suggestion.question);
  const [answer, setAnswer] = useState(suggestion.answer);
  const [reason, setReason] = useState('');
  const decide = useDecideSuggestion(workspaceId, suggestion.id);
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm">{strings.knowledge.approve}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{strings.knowledge.approve}</DialogTitle>
            <DialogDescription>{suggestion.botName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`suggestion-title-${suggestion.id}`}>
              {strings.knowledge.titleLabel}
            </Label>
            <Input
              id={`suggestion-title-${suggestion.id}`}
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`suggestion-question-${suggestion.id}`}>
              {strings.knowledge.question}
            </Label>
            <textarea
              id={`suggestion-question-${suggestion.id}`}
              className="min-h-20 w-full rounded-md border border-input bg-transparent p-3 text-sm"
              maxLength={1000}
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`suggestion-answer-${suggestion.id}`}>{strings.knowledge.answer}</Label>
            <textarea
              id={`suggestion-answer-${suggestion.id}`}
              className="min-h-32 w-full rounded-md border border-input bg-transparent p-3 text-sm"
              maxLength={4000}
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value);
              }}
            />
          </div>
          <FormAlert message={decide.isError ? errorMessage(decide.error) : null} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{strings.workspaces.cancel}</Button>
            </DialogClose>
            <Button
              disabled={decide.isPending || !title.trim() || !question.trim() || !answer.trim()}
              onClick={() => {
                decide.mutate({ action: 'approve', body: { title, question, answer } });
              }}
            >
              {strings.knowledge.approve}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            {strings.knowledge.reject}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{strings.knowledge.reject}</DialogTitle>
            <DialogDescription>{suggestion.question}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`reject-reason-${suggestion.id}`}>
              {strings.knowledge.rejectReason}
            </Label>
            <textarea
              id={`reject-reason-${suggestion.id}`}
              className="min-h-20 w-full rounded-md border border-input bg-transparent p-3 text-sm"
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
          <FormAlert message={decide.isError ? errorMessage(decide.error) : null} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{strings.workspaces.cancel}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate({ action: 'reject', body: { reason } });
              }}
            >
              {strings.knowledge.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SuggestionsQueue({ workspaceId }: { workspaceId: string }) {
  const role = useWorkspaceRole();
  const isAdmin = hasRole(role, 'admin');
  const [status, setStatus] = useState<SuggestionStatus>('pending');
  const suggestions = useKnowledgeSuggestions(workspaceId, { status, limit: 50 });
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{strings.knowledge.suggestions}</h2>
          <p className="text-sm text-muted-foreground">{strings.knowledge.suggestionIntro}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {strings.knowledge.status}
          <select
            className="h-10 rounded-md border bg-background px-3"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as SuggestionStatus);
            }}
          >
            {(['pending', 'approved', 'rejected'] as const).map((value) => (
              <option key={value} value={value}>
                {strings.knowledge.suggestionStatus[value]}
              </option>
            ))}
          </select>
        </label>
      </header>
      {suggestions.isError ? <FormAlert message={errorMessage(suggestions.error)} /> : null}
      {suggestions.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {suggestions.isSuccess && suggestions.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.knowledge.suggestionEmpty}</p>
      ) : null}
      {suggestions.isSuccess ? (
        <ul className="space-y-3">
          {suggestions.data.data.map((item) => (
            <li key={item.id} className="ledger-panel space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {item.botName} · {strings.knowledge.suggestionStatus[item.status]}
                </div>
                <time className="text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </div>
              <div>
                <h3 className="text-sm font-semibold">{strings.knowledge.question}</h3>
                <p className="whitespace-pre-wrap text-sm">{item.question}</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold">{strings.knowledge.answer}</h3>
                <p className="whitespace-pre-wrap text-sm">{item.answer}</p>
              </div>
              {item.rejectReason ? (
                <p className="text-sm text-muted-foreground">
                  {strings.knowledge.rejectReason}: {item.rejectReason}
                </p>
              ) : null}
              {item.sourceId ? (
                <Link
                  className="text-sm underline"
                  to="/w/$workspaceId/bots/$botId/knowledge/$sourceId"
                  params={{ workspaceId, botId: item.botId, sourceId: item.sourceId }}
                >
                  {strings.knowledge.sourceCreated}
                </Link>
              ) : null}
              {item.status === 'pending' && isAdmin ? (
                <SuggestionActions workspaceId={workspaceId} suggestion={item} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
