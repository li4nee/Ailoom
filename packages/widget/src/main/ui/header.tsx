// SPDX-License-Identifier: MIT
import type { WidgetConfig } from '@app/shared';

import { t } from '../i18n';

export interface HeaderProps {
  config: WidgetConfig;
  onClose: () => void;
  onHandoff: () => void;
}

export function Header({ config, onClose, onHandoff }: HeaderProps) {
  return (
    <header class="ailoom-header">
      <div class="ailoom-brand">
        <span class="ailoom-avatar" aria-hidden="true">
          {config.avatarUrl === null ? (
            config.displayName.slice(0, 1).toUpperCase()
          ) : (
            <img src={config.avatarUrl} alt="" />
          )}
        </span>
        <h2>{config.displayName}</h2>
      </div>
      <div class="ailoom-header-actions">
        {config.handoffEnabled && (
          <button type="button" class="ailoom-human" onClick={onHandoff}>
            {t('talkToHuman')}
          </button>
        )}
        {config.privacyUrl !== null && (
          <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer nofollow">
            {t('privacy')}
          </a>
        )}
        <button
          type="button"
          class="ailoom-icon ailoom-close"
          aria-label={t('close')}
          onClick={onClose}
        >
          {t('close')}
        </button>
      </div>
    </header>
  );
}
