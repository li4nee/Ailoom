// SPDX-License-Identifier: AGPL-3.0-only
import { Alert, AlertDescription } from '@/components/ui/alert';

/** A form-level error, announced to screen readers as soon as it appears. */
export function FormAlert({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
