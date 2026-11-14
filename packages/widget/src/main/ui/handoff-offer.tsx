// SPDX-License-Identifier: MIT

export interface HandoffOfferProps {
  onYes: () => void;
  onNo: () => void;
}

export function HandoffOffer({ onYes, onNo }: HandoffOfferProps) {
  return (
    <div class="ailoom-handoff" role="group" aria-label="Talk to a person">
      <span>Would you like to talk to a person?</span>
      <div class="ailoom-actions">
        <button type="button" class="ailoom-button" data-primary="true" onClick={onYes}>
          Yes, connect me
        </button>
        <button type="button" class="ailoom-button" data-secondary="true" onClick={onNo}>
          No, keep chatting
        </button>
      </div>
    </div>
  );
}
