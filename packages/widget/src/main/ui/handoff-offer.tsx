// SPDX-License-Identifier: MIT
import { t } from '../i18n';

export interface HandoffOfferProps {
  onYes: () => void;
  onNo: () => void;
}

export function HandoffOffer({ onYes, onNo }: HandoffOfferProps) {
  return (
    <div class="ailoom-handoff" role="group" aria-label="Talk to a person">
      <span>{t('handoffOfferQuestion')}</span>
      <div class="ailoom-actions">
        <button type="button" class="ailoom-button" data-primary="true" onClick={onYes}>
          {t('handoffYes')}
        </button>
        <button type="button" class="ailoom-button" data-secondary="true" onClick={onNo}>
          {t('handoffNo')}
        </button>
      </div>
    </div>
  );
}
