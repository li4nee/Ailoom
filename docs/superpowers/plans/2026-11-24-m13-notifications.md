# M13 — Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each member an in-app notification center and per-user email preferences, so agents
stop missing handoffs and assignments.

**Architecture:** A single `NotificationsService.notify(event)` turns domain events into per-user
rows in a new `notifications` table. It then sends email only to users whose preference for that
type allows it. Delivery to the open admin uses the existing workspace LISTEN/NOTIFY SSE stream,
with a `notification.created` event carrying only `{ userId }`; the client refetches.
Preferences live on `memberships` as JSONB, because they are per workspace. Today's
workspace-level `notificationEmails` setting stays as an extra recipient list for handoff and
spend emails, so existing installs behave the same.

**Tech Stack:** NestJS, Postgres LISTEN/NOTIFY (`notifyWorkspace`), pg-boss email jobs, React admin.

**Spec:** `docs/spec.md` §27 "Notifications: in-app notification center, per-user email preferences."

## Global Constraints

See `2026-11-24-00-phase2-index.md`.

## Notification types and recipients

| Type                    | Trigger (existing or new event)                     | In-app recipients                 | Email default                     |
| ----------------------- | --------------------------------------------------- | --------------------------------- | --------------------------------- |
| `handoff_requested`     | handoff listener (`handoff-notifier.listener.ts`)   | all members                       | on for owner/admin, off for agent |
| `conversation_assigned` | assignment mutation (assignee ≠ actor)              | the assignee                      | on                                |
| `visitor_replied`       | visitor message on a conversation in `human` status | the assignee (none if unassigned) | off                               |
| `spend_alert`           | spend-alerts processor                              | owners and admins                 | on                                |
| `suggestion_created`    | M12 `suggestion_created`                            | owners and admins                 | off                               |
| `suggestion_reviewed`   | M12 `suggestion_reviewed`                           | the suggestion's creator          | off                               |

- **Rules:** the actor never notifies themselves. In-app rows are always written; only email is optional. Users mute a type in-app by turning both channels off, and there's a "mute in-app" toggle for that.
- **Payload:** `{ conversationId?, botId?, suggestionId?, title, body }`. `title` and `body` are fixed strings plus escaped names. They never contain visitor message content beyond a 140-character preview, and never for `visitor_replied` when the conversation has internal-only data.
- **Retention:** read notifications older than 90 days, and all notifications older than 180 days, are deleted by the existing retention job.

## Review Focus

1. A member is removed from the workspace: their notifications are deleted, they get no further email, and SSE events for them are ignored. Test it in Task 1.
2. Handoff email for an install with workspace `notificationEmails` set: those addresses still get it, and no member gets it twice. The current `alertRecipients` behaviour stays a superset. Test it in Task 2.
3. A burst of 50 visitor replies on one assigned conversation: collapse to one unread `visitor_replied` per conversation per user (update `created_at`, keep unread). Test it in Task 2.
4. User A must never read or mark User B's notification: a foreign id → 404, the same as cross-workspace. Add it to the route-isolation inventory.
5. The email job fails: the in-app row still exists, and the email retries via the existing `email.send` job semantics. Test it in Task 2.

---

### Task 1: Storage, preferences and read API

**Files:**

- Create: `apps/api/src/db/migrations/<ts>-notifications.ts`
- Create: `apps/api/src/modules/notifications/` (`notification.entity.ts`, `notifications.repository.ts`, `notifications.controller.ts`, `notification-preferences.service.ts`, `notifications.module.ts`, `index.ts`)
- Create: `packages/shared/src/notifications.ts`
- Modify: `apps/api/src/modules/workspaces/entities/membership.entity.ts`
- Modify: the workspace member-removal and purge paths (delete the user's notifications)
- Test: `apps/api/src/modules/notifications/notifications.int.spec.ts`

**Interfaces:**

- Produces: table `notifications`:
  - `id uuid PK default uuidv7()`
  - `workspace_id uuid NOT NULL`
  - `user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE`
  - `type notification_type NOT NULL`, an enum of the six types above
  - `payload jsonb NOT NULL`
  - `dedupe_key text NULL`
  - `read_at timestamptz NULL`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - Index: `(workspace_id, user_id, read_at, created_at DESC)`
  - Unique: `(workspace_id, user_id, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL`
- Produces: column `memberships.notification_preferences jsonb NOT NULL DEFAULT '{}'`, with shape `Partial<Record<NotificationType, { email: boolean; inApp: boolean }>>`. Missing keys use the defaults table, via `effectivePreferences(role, stored)`.
- Produces routes, scoped to the current user in the workspace:
  - `GET v1/workspaces/:workspaceId/notifications?unread=&cursor=&limit=` → `{ data: NotificationDto[]; nextCursor; unreadCount }`
  - `POST …/notifications/:id/read`
  - `POST …/notifications/read-all`
  - `GET …/notification-preferences` → `NotificationPreferencesDto`
  - `PUT …/notification-preferences`
- Produces: `NotificationDto = { id, type, payload, readAt, createdAt }`.

- [ ] **Step 1: Write failing tests**:
  - List returns only the caller's rows, newest first, paginated, with `unreadCount`.
  - Mark read and read-all.
  - A foreign id → 404.
  - Preferences GET returns the role defaults; PUT validates types and persists.
  - Member removal deletes the user's rows.
  - Retention deletes rows by the stated ages.
- [ ] **Step 2:** Run `pnpm --filter @app/api test:int src/modules/notifications`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add routes to the isolation inventory, and extend the retention processor.
- [ ] **Step 4:** Run the tests and `pnpm db:check`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(notifications): store per-user notifications and preferences"`

### Task 2: Emit notifications from domain events

**Files:**

- Create: `apps/api/src/modules/notifications/notifications.service.ts`
- Modify: `apps/api/src/modules/conversations/handoff-notifier.listener.ts`, `agent-actions.service.ts` (assignment), the visitor-message path in `chat-persistence.service.ts` (for `human` status), `apps/api/src/modules/usage/spend-alerts.processor.ts`, the M12 suggestion events
- Modify: `apps/api/src/modules/email/templates/` (add `conversation-assigned.ts`, `visitor-replied.ts`, `suggestion.ts`, using the same layout and escaping)
- Test: `apps/api/src/modules/notifications/notify.int.spec.ts`

**Interfaces:**

- Produces: `NotificationsService.notify(manager: EntityManager, event: NotificationEvent): Promise<void>`. `NotificationEvent` is a discriminated union, one member per type, carrying `workspaceId`, `actorUserId | null` and the payload ids. It runs inside the caller's transaction, enqueues `email.send` jobs for opted-in users, and calls `notifyWorkspace(manager, workspaceId, { type: 'notification.created', userIds })`.
- Consumes: `EmailService` / `email.send` job, `notifyWorkspace`.

- [ ] **Step 1: Write failing tests**, one per type:
  - The right recipients get a row.
  - The actor is excluded.
  - Email is enqueued only for opted-in users.
  - Handoff email recipients = (opted-in members ∪ workspace `notificationEmails`) with no duplicates.
  - The `visitor_replied` dedupe collapses bursts.
  - Email failure leaves the row.
  - The SSE payload carries user ids only.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Replace the direct `email.send` loop in the handoff listener with `notify`. Keep `alertRecipients` for the workspace-level list.
- [ ] **Step 4:** Run the notifications, conversations and usage integration suites. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(notifications): notify members of handoffs, assignments and alerts"`

### Task 3: Notification center and preferences UI

**Files:**

- Create: `apps/admin/src/features/notifications/` (`notification-bell.tsx`, `notification-list.tsx`, `preferences-form.tsx`, `api.ts`)
- Modify: `apps/admin/src/components/app-shell.tsx` (the bell, with an unread badge, in the header)
- Modify: the account settings route (a Notifications section), the workspace SSE handler (invalidate on `notification.created` when the current user is included), strings
- Modify: `apps/docs/src/content/docs/agent-productivity.md` (a notifications section), `README.md`
- Test: `apps/admin/src/features/notifications/notifications.spec.tsx`

- [ ] **Step 1: Write failing admin tests**:
  - The badge shows `unreadCount`, capped at "99+".
  - The dropdown lists items with a relative time; clicking marks read and navigates to the conversation or suggestion.
  - "Mark all read" works.
  - An SSE event refetches.
  - The preferences form shows the defaults per role and saves.
  - Keyboard: the bell is a button with `aria-expanded`; Escape closes and returns focus.
  - Works at 375 px.
- [ ] **Step 2:** Implement. Keep the existing browser-notification toggle; it now fires on `notification.created` for the current user instead of inbox polling.
- [ ] **Step 3:** Run `pnpm --filter @app/admin exec vitest run src/features/notifications src/components`. Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -s -m "feat(admin): add the notification center and email preferences"`
