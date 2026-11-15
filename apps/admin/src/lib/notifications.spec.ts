// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
  notifyNeedsHuman,
} from './notifications';

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(() => {
    FakeNotification.permission = 'granted';
    return Promise.resolve<NotificationPermission>('granted');
  });
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

const event = {
  conversationId: 'c1',
  workspaceId: 'w1',
  botName: 'Help',
  preview: 'A visitor is waiting.',
};

function visibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

beforeEach(() => {
  localStorage.clear();
  FakeNotification.instances = [];
  FakeNotification.permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal(
    'Audio',
    class {
      volume = 1;
      play = vi.fn(() => Promise.resolve());
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  disableNotifications();
});

describe('notification opt-in', () => {
  it('stays off until the user enables it', () => {
    expect(notificationsEnabled()).toBe(false);
  });

  it('asks for permission only when enabling', async () => {
    FakeNotification.permission = 'default';
    expect(await enableNotifications()).toBe(true);
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(notificationsEnabled()).toBe(true);
  });

  it('does not opt in when permission is denied', async () => {
    FakeNotification.permission = 'denied';
    expect(await enableNotifications()).toBe(false);
    expect(notificationsEnabled()).toBe(false);
  });
});

describe('notifyNeedsHuman', () => {
  it('does nothing while the inbox tab is visible', () => {
    localStorage.setItem('ailoom:needs-human-notifications', '1');
    visibility('visible');
    notifyNeedsHuman(event);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('does nothing without the opt-in', () => {
    visibility('hidden');
    notifyNeedsHuman(event);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('notifies while hidden and opens the conversation on click', () => {
    localStorage.setItem('ailoom:needs-human-notifications', '1');
    visibility('hidden');
    const focus = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('window', { focus, location: { assign } });

    notifyNeedsHuman(event);

    const [notification] = FakeNotification.instances;
    expect(notification?.title).toContain('Help');
    expect(notification?.options?.body).toBe(event.preview);
    notification?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/w/w1/conversations/c1');
  });
});
