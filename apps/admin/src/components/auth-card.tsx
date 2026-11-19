// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

/** The centered card every signed-out page uses. */
export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-shell flex min-h-screen items-center justify-center p-4">
      <Card className="auth-card w-full max-w-sm p-0">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">{title}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
        {footer === undefined ? null : (
          <CardFooter className="flex flex-col gap-2 text-sm">{footer}</CardFooter>
        )}
      </Card>
    </main>
  );
}
