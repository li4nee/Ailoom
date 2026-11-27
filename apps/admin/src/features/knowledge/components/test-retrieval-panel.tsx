// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import {
  selectUsedChunks,
  testRetrievalResponseSchema,
  type TestRetrievalResponse,
} from '@app/shared';

import { useBot, useUpdateBot } from '../../bots/api';

/**
 * Spec §13.3: the admin tunes the threshold against real chunks. `used` is recomputed locally
 * from the slider with the same `selectUsedChunks` rule chat uses, so the preview matches what
 * saving would do.
 */
export function TestRetrievalPanel({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const [query, setQuery] = useState('');
  const [threshold, setThreshold] = useState<number | null>(null);
  const [retrievalMode, setRetrievalMode] = useState<'vector' | 'hybrid' | null>(null);
  const search = useMutation({
    mutationFn: (input: { question: string; mode: 'vector' | 'hybrid'; threshold: number }) =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/test-retrieval`, {
        method: 'POST',
        body: { query: input.question, retrievalMode: input.mode, threshold: input.threshold },
        schema: testRetrievalResponseSchema,
      }),
  });
  const update = useUpdateBot(workspaceId, botId);

  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  if (bot.data === undefined) return <Skeleton className="h-48 w-full" />;

  const value = threshold ?? bot.data.retrievalThreshold;
  const mode = retrievalMode ?? bot.data.retrievalMode;
  const results = search.data?.results ?? [];
  const used = new Set(selectUsedChunks(results, value).map((result) => result.chunkId));
  const firstUnused = results.findIndex((result) => !used.has(result.chunkId));

  return (
    <div className="max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{strings.knowledge.test.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.knowledge.test.intro}</p>
      </header>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim() !== '')
            search.mutate({ question: query.trim(), mode, threshold: value });
        }}
      >
        <label className="text-sm font-medium" htmlFor="test-retrieval-query">
          {strings.knowledge.test.query}
        </label>
        <textarea
          id="test-retrieval-query"
          className="min-h-24 w-full rounded-md border border-input bg-transparent p-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px]"
          value={query}
          maxLength={2000}
          required
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <Button type="submit" disabled={search.isPending}>
          {search.isPending ? strings.knowledge.test.running : strings.knowledge.test.run}
        </Button>
      </form>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="test-retrieval-mode">
          Search mode
        </label>
        <select
          id="test-retrieval-mode"
          className="min-h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={mode}
          disabled={!isAdmin}
          onChange={(event) => {
            setRetrievalMode(event.target.value as 'vector' | 'hybrid');
          }}
        >
          <option value="vector">Semantic search</option>
          <option value="hybrid">Hybrid search</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Preview a mode for this question, then save it to change the bot.
        </p>
      </div>

      <FormAlert message={errorMessage(search.error)} />

      {search.data === undefined ? null : (
        <>
          <p className="text-sm text-muted-foreground">
            {strings.knowledge.test.model}: {search.data.embeddingModel} ·{' '}
            {search.data.retrievalMode === 'hybrid' ? 'Hybrid search' : 'Semantic search'}
            {search.data.rerankingApplied
              ? ` · locally reranked in ${String(search.data.rerankingMs)} ms`
              : ''}
            {search.data.rerankingFailure !== null
              ? ' · hybrid order retained (reranker unavailable)'
              : ''}
          </p>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{strings.knowledge.test.empty}</p>
          ) : (
            <>
              <ul className="space-y-3 md:hidden">
                {results.map((result, index) => (
                  <li key={result.chunkId}>
                    {index === firstUnused ? (
                      <div
                        role="separator"
                        aria-label={strings.knowledge.test.cutoff}
                        className="mb-3 border-t-2 border-dashed"
                      />
                    ) : null}
                    <article className="ledger-panel min-w-0 space-y-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium">
                          {strings.knowledge.test.rank} {result.rank}
                          {result.originalRank !== null &&
                          result.originalRank !== undefined &&
                          result.originalRank !== result.rank
                            ? ` · hybrid rank ${String(result.originalRank)}`
                            : ''}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {strings.knowledge.test.score}: {result.score.toFixed(3)}
                          {result.rerankScore === null || result.rerankScore === undefined
                            ? ''
                            : ` · rerank ${result.rerankScore.toFixed(3)}`}
                        </span>
                      </div>
                      {(result.vectorRank !== null && result.vectorRank !== undefined) ||
                      (result.keywordRank !== null && result.keywordRank !== undefined) ? (
                        <p className="text-xs text-muted-foreground">
                          {result.vectorRank === null || result.vectorRank === undefined
                            ? 'No semantic match'
                            : `Semantic rank ${String(result.vectorRank)}`}
                          {' · '}
                          {result.keywordRank === null || result.keywordRank === undefined
                            ? 'No keyword match'
                            : `Keyword rank ${String(result.keywordRank)}`}
                        </p>
                      ) : null}
                      <p className="break-words font-medium">{result.title}</p>
                      <p className="break-words text-sm text-muted-foreground">{result.preview}</p>
                      <p className="text-xs font-medium">
                        {used.has(result.chunkId)
                          ? strings.knowledge.test.used
                          : strings.knowledge.test.unused}
                      </p>
                    </article>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{strings.knowledge.test.rank}</TableHead>
                      <TableHead>{strings.knowledge.test.score}</TableHead>
                      <TableHead>{strings.knowledge.sources}</TableHead>
                      <TableHead>{strings.knowledge.test.usedColumn}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((result, index) => (
                      <ResultRows
                        key={result.chunkId}
                        result={result}
                        used={used.has(result.chunkId)}
                        cutBefore={index === firstUnused}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="test-retrieval-threshold">
          {strings.knowledge.test.threshold}: {value.toFixed(2)}
        </label>
        <input
          id="test-retrieval-threshold"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          className="w-full"
          onChange={(event) => {
            setThreshold(Number(event.target.value));
          }}
        />
        <p className="text-xs text-muted-foreground">{strings.knowledge.test.cutoff}</p>
        {isAdmin &&
        ((threshold !== null && threshold !== bot.data.retrievalThreshold) ||
          mode !== bot.data.retrievalMode) ? (
          <Button
            variant="outline"
            disabled={update.isPending}
            onClick={() => {
              update.mutate({ retrievalThreshold: value, retrievalMode: mode });
            }}
          >
            {strings.knowledge.test.save}
          </Button>
        ) : null}
        {update.isSuccess ? <p role="status">{strings.knowledge.test.saved}</p> : null}
        <FormAlert message={errorMessage(update.error)} />
      </div>
    </div>
  );
}

function ResultRows({
  result,
  used,
  cutBefore,
}: {
  result: TestRetrievalResponse['results'][number];
  used: boolean;
  cutBefore: boolean;
}) {
  return (
    <>
      {cutBefore ? (
        <TableRow>
          <TableCell colSpan={4} className="p-0">
            <div
              role="separator"
              aria-label={strings.knowledge.test.cutoff}
              className="border-t-2 border-dashed"
            />
          </TableCell>
        </TableRow>
      ) : null}
      <TableRow>
        <TableCell>
          {result.rank}
          {result.originalRank !== null &&
          result.originalRank !== undefined &&
          result.originalRank !== result.rank ? (
            <span className="block text-xs text-muted-foreground">
              Hybrid {result.originalRank}
            </span>
          ) : null}
        </TableCell>
        <TableCell className="tabular-nums">
          {result.score.toFixed(3)}
          {result.rerankScore === null || result.rerankScore === undefined ? null : (
            <span className="block text-xs text-muted-foreground">
              Rerank {result.rerankScore.toFixed(3)}
            </span>
          )}
        </TableCell>
        <TableCell>
          <p className="font-medium">{result.title}</p>
          <p className="text-xs text-muted-foreground">{result.preview}</p>
        </TableCell>
        <TableCell>{used ? strings.knowledge.test.used : strings.knowledge.test.unused}</TableCell>
      </TableRow>
    </>
  );
}
