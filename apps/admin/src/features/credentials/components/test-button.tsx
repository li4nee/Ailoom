// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@/components/ui/button';
import { strings } from '@/strings';
import type { ProviderErrorCode } from '@app/shared';

import { useTestCredential } from '../api';

interface Props {
  workspaceId: string;
  credentialId: string;
}

/**
 * Runs the API's probe and shows the result inline. A failed probe is a result, not an error:
 * the button stays enabled so the admin can retry after fixing the key or the endpoint.
 */
export function TestButton({ workspaceId, credentialId }: Props) {
  const test = useTestCredential(workspaceId);
  const result = test.data;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={test.isPending}
        onClick={() => {
          test.mutate(credentialId);
        }}
      >
        {test.isPending ? strings.credentials.testing : strings.credentials.test}
      </Button>
      {result === undefined ? null : result.ok ? (
        <span className="text-sm text-muted-foreground">{strings.credentials.testOk}</span>
      ) : (
        <span className="text-sm text-destructive">
          {strings.credentials.testFailed(failureText(result.code, result.hint))}
        </span>
      )}
    </div>
  );
}

/** The normalized code's wording plus the API's operator hint, when it has one. */
function failureText(code: ProviderErrorCode, hint: string | null): string {
  const text: string = strings.credentials.errors[code];
  return hint === null ? text : `${text} ${hint}`;
}
