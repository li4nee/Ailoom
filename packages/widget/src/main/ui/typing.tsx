// SPDX-License-Identifier: MIT
import { t } from '../i18n';

export function Typing({ checkingTool = false }: { checkingTool?: boolean }) {
  return (
    <div class="ailoom-typing" role="status">
      {t(checkingTool ? 'checking' : 'typing')}
    </div>
  );
}
