// SPDX-License-Identifier: AGPL-3.0-only
import { strings } from '@/strings';

/** Placeholder for workspace sections later milestones build. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{strings.nav.comingSoon}</p>
    </section>
  );
}
