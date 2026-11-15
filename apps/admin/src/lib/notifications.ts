// SPDX-License-Identifier: AGPL-3.0-only
const OPT_IN_KEY = 'ailoom:needs-human-notifications';
const SOUND_URL = '/sounds/needs-human.mp3';

/** Reads the opt-in flag; storage can throw in private mode, which counts as opted out. */
export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Offered only from a click: asking on page load is blocked by browsers anyway. */
export async function enableNotifications(): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
    }
    if (Notification.permission !== 'granted') return false;
    localStorage.setItem(OPT_IN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function disableNotifications(): void {
  try {
    localStorage.removeItem(OPT_IN_KEY);
  } catch {
    // Storage is unavailable; the preference simply cannot persist.
  }
}

export interface NeedsHumanNotification {
  conversationId: string;
  workspaceId: string;
  botName: string;
  preview: string;
}

function playSound(): void {
  try {
    const audio = new Audio(SOUND_URL);
    audio.volume = 0.5;
    void audio.play().catch(() => undefined);
  } catch {
    // A browser that blocks autoplay simply gets no sound.
  }
}

/**
 * Browser notification for a conversation that just moved to `needs_human` (spec §17.7).
 * Nothing happens unless the user opted in, permission is granted and the tab is hidden.
 */
export function notifyNeedsHuman(event: NeedsHumanNotification): void {
  if (!notificationsEnabled()) return;
  if (document.visibilityState !== 'hidden') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const notification = new Notification(`${event.botName} needs a person`, {
    body: event.preview,
    tag: event.conversationId,
  });
  notification.onclick = () => {
    window.focus();
    window.location.assign(`/w/${event.workspaceId}/conversations/${event.conversationId}`);
    notification.close();
  };
  playSound();
}
