// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useNotifications: vi.fn(),
  useMarkNotificationRead: vi.fn(),
  useMarkAllNotificationsRead: vi.fn(),
  useNotificationPreferences: vi.fn(),
  useSaveNotificationPreferences: vi.fn(),
  markRead: { mutateAsync: vi.fn() },
  markAll: { mutate: vi.fn(), isPending: false },
  save: {
    mutateAsync: vi.fn(),
    mutate: vi.fn((_preferences: unknown, options: { onSuccess: () => void }) => {
      options.onSuccess();
    }),
    isPending: false,
    isError: false,
  },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('./api', () => ({
  useNotifications: mocks.useNotifications,
  useMarkNotificationRead: mocks.useMarkNotificationRead,
  useMarkAllNotificationsRead: mocks.useMarkAllNotificationsRead,
  useNotificationPreferences: mocks.useNotificationPreferences,
  useSaveNotificationPreferences: mocks.useSaveNotificationPreferences,
}));

import { renderWithQuery } from '@/test/render';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPES,
  type NotificationDto,
  type NotificationPreferencesDto,
} from '@app/shared';

import { NotificationBell } from './notification-bell';
import { PreferencesForm } from './preferences-form';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    type: 'conversation_assigned',
    payload: {
      conversationId: '33333333-3333-4333-8333-333333333333',
      title: 'Conversation assigned',
      body: 'A conversation was assigned to you.',
    },
    readAt: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function page(unreadCount: number, data = [notification()]) {
  return { data, nextCursor: null, unreadCount };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markRead.mutateAsync.mockResolvedValue(notification({ readAt: new Date().toISOString() }));
  mocks.markAll.mutate = vi.fn();
  mocks.save.mutate.mockImplementation((_preferences, options) => {
    options.onSuccess();
  });
  mocks.useNotifications.mockReturnValue({ data: page(1), isPending: false, isError: false });
  mocks.useMarkNotificationRead.mockReturnValue(mocks.markRead);
  mocks.useMarkAllNotificationsRead.mockReturnValue(mocks.markAll);
  const defaults = DEFAULT_NOTIFICATION_PREFERENCES.agent;
  mocks.useNotificationPreferences.mockReturnValue({
    data: defaults,
    isPending: false,
    isError: false,
  });
  mocks.useSaveNotificationPreferences.mockReturnValue(mocks.save);
});

describe('NotificationBell', () => {
  it('shows the unread count capped at 99+', () => {
    mocks.useNotifications.mockReturnValue({ data: page(140), isPending: false, isError: false });
    renderWithQuery(<NotificationBell workspaceId={WORKSPACE_ID} />);

    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications, 140 unread' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens the list, marks an item read, and navigates to its conversation', async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationBell workspaceId={WORKSPACE_ID} />);

    const trigger = screen.getByRole('button', { name: 'Notifications, 1 unread' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('A conversation was assigned to you.')).toBeInTheDocument();
    expect(screen.getByText(/minute ago/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Conversation assigned/ }));

    await waitFor(() => {
      expect(mocks.markRead.mutateAsync).toHaveBeenCalledWith(notification().id);
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/w/$workspaceId/conversations/$conversationId',
      params: {
        workspaceId: WORKSPACE_ID,
        conversationId: '33333333-3333-4333-8333-333333333333',
      },
    });
  });

  it('marks all read and returns focus to the bell after Escape', async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationBell workspaceId={WORKSPACE_ID} />);
    const trigger = screen.getByRole('button', { name: 'Notifications, 1 unread' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: /Mark all read/ }));
    expect(mocks.markAll.mutate).toHaveBeenCalledOnce();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('navigates correction notifications to the suggestions queue', async () => {
    const user = userEvent.setup();
    const item = notification({
      type: 'suggestion_created',
      payload: {
        suggestionId: '44444444-4444-4444-8444-444444444444',
        title: 'Correction needs review',
        body: 'An agent submitted a correction.',
      },
    });
    mocks.useNotifications.mockReturnValue({
      data: page(1, [item]),
      isPending: false,
      isError: false,
    });
    renderWithQuery(<NotificationBell workspaceId={WORKSPACE_ID} />);
    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(screen.getByRole('button', { name: /Correction needs review/ }));

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/w/$workspaceId/knowledge/suggestions',
      params: { workspaceId: WORKSPACE_ID },
    });
  });
});

describe('PreferencesForm', () => {
  it('shows role defaults and saves updated channel preferences', async () => {
    const user = userEvent.setup();
    const defaults = DEFAULT_NOTIFICATION_PREFERENCES.agent satisfies NotificationPreferencesDto;
    mocks.useNotificationPreferences.mockReturnValue({
      data: defaults,
      isPending: false,
      isError: false,
    });
    renderWithQuery(<PreferencesForm workspaceId={WORKSPACE_ID} />);

    const handoffEmail = screen.getByRole('checkbox', {
      name: 'A conversation needs a person — Email',
    });
    expect(handoffEmail).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'A conversation needs a person — In app' }),
    ).toBeChecked();

    await user.click(handoffEmail);
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(mocks.save.mutate).toHaveBeenCalledOnce();
    });
    const saved = mocks.save.mutate.mock.calls[0]?.[0] as NotificationPreferencesDto;
    expect(saved.handoff_requested).toEqual({ email: true, inApp: true });
    expect(Object.keys(saved)).toHaveLength(NOTIFICATION_TYPES.length);
    expect(screen.getByRole('status')).toHaveTextContent('Preferences saved.');
  });
});
