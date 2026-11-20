// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useDocument } from '../api';
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
    </div>
  );
}
