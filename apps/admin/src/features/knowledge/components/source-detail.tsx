// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useSource } from '../api';
import { SourceStatus } from './source-status';

/** The source's page: status, metadata and one page of its documents. */
export function SourceDetail({
  workspaceId,
  botId,
  sourceId,
}: {
  workspaceId: string;
  botId: string;
  sourceId: string;
}) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const source = useSource(workspaceId, botId, sourceId);

  if (source.isError) return <FormAlert message={errorMessage(source.error)} />;
  if (source.data === undefined) return <Skeleton className="h-48 w-full" />;
  const detail = source.data;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{detail.title}</h1>
        <SourceStatus
          status={detail.status}
          pagesDone={detail.pagesDone}
          pagesTotal={detail.pagesTotal}
        />
        {detail.sourceUrl === null ? null : (
          <a className="text-sm text-primary underline" href={detail.sourceUrl} rel="noreferrer">
            {detail.sourceUrl}
          </a>
        )}
        {detail.error === null ? null : <FormAlert message={detail.error} />}
        {isAdmin ? null : (
          <p className="text-sm text-muted-foreground">{strings.knowledge.agentsReadOnly}</p>
        )}
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold">{strings.knowledge.documents}</h2>
        {detail.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.knowledge.noDocuments}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {detail.documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <Link
                  to="/w/$workspaceId/bots/$botId/knowledge/documents/$documentId"
                  params={{ workspaceId, botId, documentId: document.id }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {document.title ?? document.url ?? document.id}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {strings.knowledge.chunks(document.chunkCount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
