// SPDX-License-Identifier: MIT
import { useState } from 'preact/hooks';

import { t } from '../i18n';

export interface ComposerProps {
  disabled: boolean;
  onSend: (content: string) => void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');

  const send = (): void => {
    const content = value.trim();
    if (content === '' || disabled) return;
    setValue('');
    onSend(content);
  };

  return (
    <div class="ailoom-composer">
      <textarea
        class="ailoom-input"
        aria-label={t('inputPlaceholder')}
        placeholder={t('inputPlaceholder')}
        rows={1}
        value={value}
        disabled={disabled}
        onInput={(event) => {
          setValue((event.target as HTMLTextAreaElement).value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <button type="button" class="ailoom-send" disabled={disabled} onClick={send}>
        {t('send')}
      </button>
    </div>
  );
}
