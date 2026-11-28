// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useDocument, useEditDocument, useVersionDiff, useVersions } from '../api';
import { WarningList } from './warning-list';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- the version diff needs keyboard scrolling */
/** The current version and its ordered chunks; the API never sends embeddings. */
export function DocumentViewer({
  workspaceId,
  botId,
  documentId,
}: {
  workspaceId: string;
  botId: string;
  documentId: string;
}) {
  const document = useDocument(workspaceId, botId, documentId);
  const versions = useVersions(workspaceId, botId, documentId);
  const edit = useEditDocument(workspaceId, botId, documentId);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const diff = useVersionDiff(workspaceId, botId, documentId, fromId, toId);
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');

  if (document.isError) return <FormAlert message={errorMessage(document.error)} />;
  if (document.data === undefined) {
    return (
      <div role="status" aria-label={strings.knowledge.document.loading} className="space-y-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  const { document: doc, currentVersion, chunks } = document.data;

  return (
    <div className="space-y-8">
      <Link
        to="/w/$workspaceId/bots/$botId/knowledge"
        params={{ workspaceId, botId }}
        className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {strings.bots.tabs.knowledge}
      </Link>

      <header className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="ledger-heading min-w-0 break-words text-2xl">
            {doc.title ?? strings.knowledge.document.title}
          </h1>
          {doc.status === 'unreachable' || doc.status === 'removed' ? (
            <span
              className={
                doc.status === 'unreachable'
                  ? 'rounded-full border border-destructive/40 bg-destructive/5 px-3 py-1 text-sm text-destructive'
                  : 'rounded-full border px-3 py-1 text-sm text-muted-foreground'
              }
              title={
                doc.status === 'unreachable'
                  ? strings.knowledge.unreachableHint
                  : strings.knowledge.removedHint
              }
            >
              {doc.status === 'unreachable'
                ? strings.knowledge.unreachable
                : strings.knowledge.removed}
            </span>
          ) : null}
        </div>
        {doc.url === null ? null : (
          <a
            className="block max-w-full break-all text-sm text-accent-2 underline underline-offset-4"
            href={doc.url}
            rel="noreferrer"
          >
            {doc.url}
          </a>
        )}
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-x-2">
            <dt>{strings.knowledge.lastChecked}</dt>
            <dd>
              {doc.lastCheckedAt === null ? (
                strings.knowledge.freshness.never
              ) : (
                <time dateTime={doc.lastCheckedAt}>
                  {new Date(doc.lastCheckedAt).toLocaleString()}
                </time>
              )}
            </dd>
          </div>
        </dl>
      </header>

      {currentVersion === null ? (
        <p className="text-sm text-muted-foreground">{strings.knowledge.document.noVersion}</p>
      ) : (
        <>
          <section aria-labelledby="current-version-title" className="space-y-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="current-version-title" className="text-lg font-semibold">
                  {strings.knowledge.document.version}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {strings.knowledge.chunks(chunks.length)}
                </span>
              </div>
              <time className="text-sm text-muted-foreground" dateTime={currentVersion.createdAt}>
                {new Date(currentVersion.createdAt).toLocaleString()}
              </time>
            </header>
            <WarningList warnings={currentVersion.warnings} />
            {chunks.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {strings.knowledge.document.noChunks}
              </p>
            ) : (
              <ol className="divide-y overflow-hidden rounded-xl border bg-card">
                {chunks.map((chunk) => (
                  <li key={chunk.ordinal} className="min-w-0 px-4 py-5 sm:px-6">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span className="font-medium text-foreground">
                        {strings.knowledge.document.chunk(chunk.ordinal)}
                      </span>
                      <span className="text-muted-foreground">
                        {strings.knowledge.document.tokens(chunk.tokenCount)}
                      </span>
                      {chunk.headingPath === '' ? null : (
                        <span className="min-w-0 break-words text-muted-foreground">
                          {strings.knowledge.document.heading}: {chunk.headingPath}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-7 text-foreground/90">
                      {chunk.content}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
      <section
        aria-labelledby="version-history-title"
        className="ledger-panel space-y-4 p-4 sm:p-5"
      >
        <header className="space-y-1">
          <h2 id="version-history-title" className="text-lg font-semibold">
            {strings.knowledge.document.versions}
          </h2>
          <p className="text-sm text-muted-foreground">{strings.knowledge.document.compareHint}</p>
        </header>
        {versions.isError ? <FormAlert message={errorMessage(versions.error)} /> : null}
        {versions.isPending ? <Skeleton className="h-10 w-full" /> : null}
        {versions.isSuccess && versions.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {strings.knowledge.document.versionsUnavailable}
          </p>
        ) : null}
        {versions.data?.data.length ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 text-sm font-medium">
              {strings.knowledge.document.from}
              <NativeSelect
                className="w-full"
                value={fromId}
                onChange={(event) => {
                  setFromId(event.currentTarget.value);
                }}
              >
                <option value="">{strings.knowledge.document.chooseVersion}</option>
                {versions.data.data.map((version) => (
                  <option key={version.id} value={version.id}>
                    {new Date(version.createdAt).toLocaleString()}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium">
              {strings.knowledge.document.to}
              <NativeSelect
                className="w-full"
                value={toId}
                onChange={(event) => {
                  setToId(event.currentTarget.value);
                }}
              >
                <option value="">{strings.knowledge.document.chooseVersion}</option>
                {versions.data.data.map((version) => (
                  <option key={version.id} value={version.id}>
                    {new Date(version.createdAt).toLocaleString()}
                    {version.isCurrent ? ` · ${strings.knowledge.document.current}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
        ) : null}
        {diff.isError ? <FormAlert message={errorMessage(diff.error)} /> : null}
        {diff.isPending && fromId !== '' && toId !== '' ? (
          <Skeleton className="h-32 w-full" />
        ) : null}
        {diff.data ? (
          <div
            aria-label={strings.knowledge.document.diff}
            className="max-h-[32rem] overflow-auto rounded-lg border bg-background p-4 font-mono text-xs"
            role="region"
            tabIndex={0}
          >
            {diff.data.hunks.length === 0 ? (
              <p className="text-sm font-sans">{strings.knowledge.document.noDifferences}</p>
            ) : null}
            {diff.data.hunks.flatMap((hunk, index) =>
              hunk.lines.map((line, lineIndex) => (
                <p
                  key={`${String(index)}-${String(lineIndex)}`}
                  className={
                    line.kind === 'add'
                      ? 'whitespace-pre-wrap text-emerald-700 dark:text-emerald-300'
                      : line.kind === 'remove'
                        ? 'whitespace-pre-wrap text-rose-700 dark:text-rose-300'
                        : 'whitespace-pre-wrap text-muted-foreground'
                  }
                >
                  <span className="mr-2 font-sans">
                    {line.kind === 'add'
                      ? strings.knowledge.document.added
                      : line.kind === 'remove'
                        ? strings.knowledge.document.removedLine
                        : strings.knowledge.document.context}
                  </span>
                  {line.text}
                </p>
              )),
            )}
            {diff.data.truncated ? (
              <p role="status">{strings.knowledge.document.diffTruncated}</p>
            ) : null}
          </div>
        ) : null}
      </section>
      {doc.url === null && isAdmin ? (
        <section
          aria-label={strings.knowledge.document.edit}
          className="ledger-panel space-y-4 p-4 sm:p-5"
        >
          {!editing ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setContent(currentVersion?.content ?? '');
                setEditing(true);
              }}
            >
              {strings.knowledge.document.edit}
            </Button>
          ) : (
            <div className="space-y-3">
              <h2 id="edit-content-title" className="text-lg font-semibold">
                {strings.knowledge.document.content}
              </h2>
              <label className="block space-y-1 text-sm">
                <span>{strings.knowledge.document.content}</span>
                <textarea
                  className="min-h-64 w-full rounded-lg border border-input bg-background p-4 font-mono text-sm leading-6 shadow-none outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={content}
                  onChange={(event) => {
                    setContent(event.currentTarget.value);
                  }}
                  maxLength={200 * 1024}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={edit.isPending || content.trim() === ''}
                  onClick={() => {
                    edit.mutate(content, {
                      onSuccess: (result) => {
                        if (result.changed) setEditing(false);
                      },
                    });
                  }}
                >
                  {edit.isPending
                    ? strings.knowledge.document.saving
                    : strings.knowledge.document.save}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  {strings.knowledge.document.cancel}
                </Button>
              </div>
              {edit.isSuccess && !edit.data.changed ? (
                <p role="status">{strings.knowledge.document.noChanges}</p>
              ) : null}
              {edit.isError ? <FormAlert message={errorMessage(edit.error)} /> : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
/* eslint-enable jsx-a11y/no-noninteractive-tabindex */
