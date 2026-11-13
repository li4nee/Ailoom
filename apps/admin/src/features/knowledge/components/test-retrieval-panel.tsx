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
  const search = useMutation({
    mutationFn: (question: string) =>
      api(`/v1/workspaces/${workspaceId}/bots/${botId}/test-retrieval`, {
        method: 'POST',
        body: { query: question },
        schema: testRetrievalResponseSchema,
      }),
  });
  const update = useUpdateBot(workspaceId, botId);

  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  if (bot.data === undefined) return <Skeleton className="h-48 w-full" />;

  const value = threshold ?? bot.data.retrievalThreshold;
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
          if (query.trim() !== '') search.mutate(query.trim());
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

      <FormAlert message={errorMessage(search.error)} />

      {search.data === undefined ? null : (
        <>
          <p className="text-sm text-muted-foreground">
            {strings.knowledge.test.model}: {search.data.embeddingModel}
          </p>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{strings.knowledge.test.empty}</p>
          ) : (
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
        {isAdmin && threshold !== null && threshold !== bot.data.retrievalThreshold ? (
          <Button
            variant="outline"
            disabled={update.isPending}
            onClick={() => {
              update.mutate({ retrievalThreshold: threshold });
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
        <TableCell>{result.rank}</TableCell>
        <TableCell className="tabular-nums">{result.score.toFixed(3)}</TableCell>
        <TableCell>
          <p className="font-medium">{result.title}</p>
          <p className="text-xs text-muted-foreground">{result.preview}</p>
        </TableCell>
        <TableCell>{used ? strings.knowledge.test.used : strings.knowledge.test.unused}</TableCell>
      </TableRow>
    </>
  );
}
