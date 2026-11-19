// SPDX-License-Identifier: AGPL-3.0-only
import { strings } from '@/strings';
import type { ExtractionWarning } from '@app/shared';

/** Every warning code with the explanation and suggested fix from spec §12.3. */
export function WarningList({ warnings }: { warnings: ExtractionWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-2">
      {warnings.map((code) => {
        const text = strings.knowledge.warnings[code];
        return (
          <li key={code} className="warning-panel rounded-md border p-3 text-sm">
            <p className="font-medium">{text.title}</p>
            <p className="text-muted-foreground">{text.fix}</p>
          </li>
        );
      })}
    </ul>
  );
}
