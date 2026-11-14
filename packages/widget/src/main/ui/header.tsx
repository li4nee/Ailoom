// SPDX-License-Identifier: MIT
import type { WidgetConfig } from '@app/shared';

export interface HeaderProps {
  config: WidgetConfig;
  onClose: () => void;
  onHandoff: () => void;
}

export function Header({ config, onClose, onHandoff }: HeaderProps) {
  return (
    <header class="ailoom-header">
      <h2>{config.displayName}</h2>
      {config.handoffEnabled && (
        <button type="button" class="ailoom-icon" onClick={onHandoff}>
          Talk to a human
        </button>
      )}
      {config.privacyUrl !== null && (
        <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer nofollow">
          Privacy
        </a>
      )}
      <button type="button" class="ailoom-icon" aria-label="Close chat" onClick={onClose}>
        ×
      </button>
    </header>
  );
}
