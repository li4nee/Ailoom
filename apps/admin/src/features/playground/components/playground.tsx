// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { parseMarkdownSubset, type Citation } from '@app/shared';

import { streamPlayground, type PlaygroundEscalation, type PlaygroundTrace } from '../api';
import { MarkdownView } from './markdown-view';
import { reasonLabel, TraceSummary } from './trace-summary';

interface Turn {
  id: number;
  question: string;
  answer: string;
  citations: Citation[];
  escalation: PlaygroundEscalation | null;
  trace: PlaygroundTrace | null;
  error: string | null;
}

let nextId = 1;

export function Playground({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const patch = (id: number, update: (turn: Turn) => Turn): void => {
    setTurns((current) => current.map((turn) => (turn.id === id ? update(turn) : turn)));
  };

  const send = async (): Promise<void> => {
    const question = draft.trim();
    if (question === '' || streaming) return;

    const history = turns
      .filter((turn) => turn.answer !== '')
      .slice(-10)
      .flatMap((turn) => [
        { role: 'visitor' as const, content: turn.question },
        { role: 'ai' as const, content: turn.answer },
      ]);

    const id = nextId;
    nextId += 1;
    setTurns((current) => [
      ...current,
      {
        id,
        question,
        answer: '',
        citations: [],
        escalation: null,
        trace: null,
        error: null,
      },
    ]);
    setDraft('');
    setStreaming(true);
    const controller = new AbortController();
    abort.current = controller;

    try {
      for await (const event of streamPlayground({
        workspaceId,
        botId,
        content: question,
        history,
        signal: controller.signal,
      })) {
        if (event.event === 'answer.delta') {
          patch(id, (turn) => ({ ...turn, answer: turn.answer + event.data.text }));
        } else if (event.event === 'answer.completed') {
          patch(id, (turn) => ({
            ...turn,
            answer: event.data.content,
            citations: event.data.citations,
          }));
        } else if (event.event === 'escalated') {
          patch(id, (turn) => ({
            ...turn,
            answer: event.data.content,
            escalation: event.data,
          }));
        } else if (event.event === 'trace') {
          patch(id, (turn) => ({ ...turn, trace: event.data }));
        } else if (event.event === 'error') {
          patch(id, (turn) => ({ ...turn, error: event.data.message }));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        patch(id, (turn) => ({ ...turn, error: errorMessage(error) }));
      }
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{strings.playground.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.playground.intro}</p>
      </header>

      <div className="space-y-4" aria-live="polite">
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.playground.empty}</p>
        ) : (
          turns.map((turn) => (
            <article key={turn.id} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{strings.playground.you}</p>
              <p className="rounded-md bg-muted px-3 py-2 text-sm">{turn.question}</p>
              <p className="text-xs font-medium text-muted-foreground">
                {strings.playground.assistant}
              </p>
              <div className="rounded-md border px-3 py-2">
                {turn.answer === '' ? (
                  <p className="text-sm text-muted-foreground">{strings.playground.sending}</p>
                ) : (
                  <MarkdownView nodes={parseMarkdownSubset(turn.answer)} />
                )}
                {turn.escalation === null ? null : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {strings.playground.escalation}: {reasonLabel(turn.escalation.reason)}
                  </p>
                )}
                {turn.citations.length === 0 ? null : <Citations citations={turn.citations} />}
                {turn.error === null ? null : <FormAlert message={turn.error} />}
                {turn.trace === null ? null : (
                  <div className="mt-2">
                    <TraceSummary trace={turn.trace} workspaceId={workspaceId} botId={botId} />
                  </div>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="text-sm font-medium" htmlFor="playground-question">
          {strings.playground.question}
        </label>
        <textarea
          id="playground-question"
          className="min-h-24 w-full rounded-md border border-input bg-transparent p-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px]"
          value={draft}
          maxLength={2000}
          required
          placeholder={strings.playground.placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        {streaming ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              abort.current?.abort();
            }}
          >
            {strings.playground.stop}
          </Button>
        ) : (
          <Button type="submit">{strings.playground.send}</Button>
        )}
      </form>
    </div>
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{strings.playground.sources}</p>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {citations.map((citation) => (
          <li key={citation.n}>
            <span className="text-muted-foreground">[{citation.n}]</span>{' '}
            {citation.url === null ? (
              citation.title
            ) : (
              <a
                className="underline underline-offset-2"
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {citation.title}
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
