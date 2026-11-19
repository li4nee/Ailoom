// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { Diagnostics, DiagnosticsCheck } from '@app/shared';

import { useDiagnostics } from '../api';

type CheckKey = keyof Diagnostics['checks'];

const CHECK_ORDER: CheckKey[] = [
  'email',
  'encryption',
  'storage',
  'worker',
  'pgvector',
  'localModel',
  'listen',
];

const STATUS_CLASS = {
  ok: 'bg-emerald-100 text-emerald-900',
  warn: 'warning-panel border',
  error: 'bg-red-100 text-red-900',
} as const;

function CheckRow({ name, check }: { name: CheckKey; check: DiagnosticsCheck }) {
  return (
    <li className="rounded-lg border p-4" data-testid={`diagnostic-${name}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{strings.instance.diagnostics.checks[name]}</h3>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[check.status]}`}>
          {strings.instance.diagnostics.status[check.status]}
        </span>
      </div>
      <p className="mt-1 text-sm">{check.detail}</p>
      {check.fix === null ? null : (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium">{strings.instance.diagnostics.fix}:</span> {check.fix}
        </p>
      )}
    </li>
  );
}

export function DiagnosticsPanel({ isInstanceAdmin }: { isInstanceAdmin: boolean }) {
  const diagnostics = useDiagnostics(isInstanceAdmin);
  if (!isInstanceAdmin) return null;
  if (diagnostics.isError) return <FormAlert message={errorMessage(diagnostics.error)} />;
  if (diagnostics.data === undefined) return <Skeleton className="h-64 w-full" />;

  const data = diagnostics.data;
  return (
    <section className="space-y-4" aria-labelledby="diagnostics-heading">
      <div>
        <h2 id="diagnostics-heading" className="text-lg font-semibold">
          {strings.instance.diagnostics.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {strings.instance.diagnostics.version(data.version)}
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {CHECK_ORDER.map((name) => (
          <CheckRow key={name} name={name} check={data.checks[name]} />
        ))}
      </ul>
      <div>
        <h3 className="font-semibold">{strings.instance.diagnostics.queues}</h3>
        {data.queues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.instance.diagnostics.noQueues}</p>
        ) : (
          <>
            <ul className="mt-2 grid gap-2 md:hidden">
              {data.queues.map((queue) => (
                <li key={queue.name} className="rounded-lg border p-3">
                  <h4 className="break-all font-medium">{queue.name}</h4>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {strings.instance.diagnostics.created}
                      </dt>
                      <dd>{queue.created}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {strings.instance.diagnostics.active}
                      </dt>
                      <dd>{queue.active}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {strings.instance.diagnostics.failed}
                      </dt>
                      <dd>{queue.failed24h}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="mt-2 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th>{strings.instance.diagnostics.queueName}</th>
                    <th>{strings.instance.diagnostics.created}</th>
                    <th>{strings.instance.diagnostics.active}</th>
                    <th>{strings.instance.diagnostics.failed}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queues.map((queue) => (
                    <tr key={queue.name}>
                      <td>{queue.name}</td>
                      <td>{queue.created}</td>
                      <td>{queue.active}</td>
                      <td>{queue.failed24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
