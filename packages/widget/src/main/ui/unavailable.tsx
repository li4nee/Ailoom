// SPDX-License-Identifier: MIT
import { t } from '../i18n';

export function Unavailable() {
  return (
    <div class="ailoom-unavailable" role="status">
      {t('unavailable')}
    </div>
  );
}
