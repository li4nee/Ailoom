// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useDocument, useEditDocument, useVersionDiff, useVersions } from '../api';
import { WarningList } from './warning-list';

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
  if (document.data === undefined) return <Skeleton className="h-48 w-full" />;
  const { document: doc, currentVersion, chunks } = document.data;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="break-words text-xl font-semibold">
          {doc.title ?? strings.knowledge.document.title}
        </h1>
        {doc.url === null ? null : (
          <a className="break-all text-sm text-primary underline" href={doc.url} rel="noreferrer">
            {doc.url}
          </a>
        )}
        {doc.status === 'unreachable' || doc.status === 'removed' ? (
          <p
            className="inline-block rounded border px-2 py-1 text-xs"
            title={
              doc.status === 'unreachable'
                ? strings.knowledge.unreachableHint
                : strings.knowledge.removedHint
            }
          >
            {doc.status === 'unreachable'
              ? strings.knowledge.unreachable
              : strings.knowledge.removed}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {strings.knowledge.lastChecked}:{' '}
          {doc.lastCheckedAt === null
            ? strings.knowledge.freshness.never
            : new Date(doc.lastCheckedAt).toLocaleString()}
        </p>
      </header>

      {currentVersion === null ? (
        <p className="text-sm text-muted-foreground">{strings.knowledge.document.noVersion}</p>
      ) : (
        <>
          <WarningList warnings={currentVersion.warnings} />
          <p className="text-sm text-muted-foreground">
            {strings.knowledge.document.version} ·{' '}
            {new Date(currentVersion.createdAt).toLocaleString()}
          </p>
          <ol className="space-y-3">
            {chunks.map((chunk) => (
              <li key={chunk.ordinal} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{strings.knowledge.document.chunk(chunk.ordinal)}</span>
                  {chunk.headingPath === '' ? null : (
                    <span className="break-words">
                      {strings.knowledge.document.heading}: {chunk.headingPath}
                    </span>
                  )}
                  <span>{strings.knowledge.document.tokens(chunk.tokenCount)}</span>
                </div>
                <p className="mt-2 break-words whitespace-pre-wrap text-sm">{chunk.content}</p>
              </li>
            ))}
          </ol>
        </>
      )}
      <section className="space-y-3 rounded-md border p-4">
        <h2 className="font-semibold">{strings.knowledge.document.versions}</h2>
        {versions.isError ? <FormAlert message={errorMessage(versions.error)} /> : null}
        {versions.data?.data.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">
              {strings.knowledge.document.from}
              <select
                className="ml-2 rounded-md border bg-background p-1"
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
              </select>
            </label>
            <label className="text-sm">
              {strings.knowledge.document.to}
              <select
                className="ml-2 rounded-md border bg-background p-1"
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
              </select>
            </label>
          </div>
        ) : null}
        {diff.isError ? <FormAlert message={errorMessage(diff.error)} /> : null}
        {diff.data ? (
          <div aria-label={strings.knowledge.document.diff} className="space-y-1 font-mono text-xs">
            {diff.data.hunks.length === 0 ? (
              <p>{strings.knowledge.document.noDifferences}</p>
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
        <section className="space-y-3 rounded-md border p-4">
          {!editing ? (
            <button
              type="button"
              className="text-sm font-medium underline"
              onClick={() => {
                setContent(currentVersion?.content ?? '');
                setEditing(true);
              }}
            >
              {strings.knowledge.document.edit}
            </button>
          ) : (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span>{strings.knowledge.document.content}</span>
                <textarea
                  className="min-h-48 w-full rounded-md border bg-background p-3 font-mono text-sm"
                  value={content}
                  onChange={(event) => {
                    setContent(event.currentTarget.value);
                  }}
                  maxLength={200 * 1024}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
                  disabled={edit.isPending || content.trim() === ''}
                  onClick={() => {
                    edit.mutate(content, {
                      onSuccess: (result) => {
                        if (result.changed) setEditing(false);
                      },
                    });
                  }}
                >
                  {strings.knowledge.document.save}
                </button>
                <button
                  type="button"
                  className="rounded-md border px-3 py-2"
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  {strings.knowledge.document.cancel}
                </button>
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
