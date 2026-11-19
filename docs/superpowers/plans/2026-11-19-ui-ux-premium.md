# AiLoom UI and UX execution plan

**Created:** 2026-11-19

**Status:** Implementation active; P1–P3 complete; P4 is next.

**Scope:** React admin frontend and Preact customer chat widget.

**Owner:** The implementing agent, with the project owner retaining product decisions.

**Direction:** Answer Ledger; charcoal, silver, and lime.

This is the working checklist for the next design pass. Update it as work lands. Earlier UI changes already exist in the working tree; they are an input to this plan, not evidence that its tasks are complete. Milestone 9 work remains separate and its completion status is not changed by this plan.

## 1. Outcome and design decisions

AiLoom should feel like a carefully made support workspace. Agents should find a conversation, understand what happened, inspect available evidence, and take the next action without hunting across the interface. Administrators should understand how bots, knowledge, and configuration fit together. Customers should find the chat widget readable and dependable on their own devices.

The product's recognizable moment will be a conversation with its answer, supporting sources, and human handoff context visibly connected. This uses capabilities already present in the repository.

### Decisions to carry into implementation

| Area | Decision | Practical effect |
| --- | --- | --- |
| Palette | Keep charcoal, silver, and lime | Charcoal anchors navigation and text; silver separates working surfaces; lime marks the primary action or selection. Semantic errors and warnings retain separate colors. |
| Type | Keep the system sans family for this pass | Establish consistent page, section, body, and metadata scales. Use tabular numbers for reports and monospace only for technical values. No external font request. |
| Shell | Refine the existing product bar and workspace navigation | Preserve destinations and workspace switching. Make navigation accessible at narrow widths and keep the active destination visible. |
| Density | Give each screen a deliberate content width | Conversation work can be wide; configuration forms use a readable measure. Empty space must follow the task and content, rather than an arbitrary full-width container. |
| Surfaces | Use one clear containment layer per working group | Borders, tonal differences, and spacing establish hierarchy; shadows are restrained. |
| Inbox | Desktop queue with a selected conversation; mobile list-to-detail flow | Keep the queue context on wide screens without squeezing messages. At narrow widths show one task at a time. |
| Conversation | Timeline first, context second, sources attached to the relevant answer | Agent actions remain easy to reach. Sources and traces only appear when real data supplies them. |
| Widget | A customer-facing conversation with its own configurable branding | Preserve bot colors, placement, display name, welcome copy, privacy link, and feature switches. Admin colors are defaults, not forced overrides. |
| Motion | Short feedback for opening, selection, and state changes | Respect reduced motion. Avoid motion that delays reading or replying. |
| Content | Use existing product facts and real seeded records | Do not add fictitious performance figures, uptime, customer claims, or fabricated source evidence. |

### Skill responsibilities

- **Hallmark:** composition, visual hierarchy, palette discipline, typography, one clear task per screen, and visual review. Apply app-screen guidance, not marketing-page hero rules.
- **Impeccable:** Operate-mode UX, responsive adaptation, state coverage, copy clarity, accessibility, and final polish. Use its shape guidance for this plan; load its craft floor before editing UI.
- Existing `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, and `.hallmark/log.json` provide context. Update design documentation after implementing decisions so it reflects the actual UI.
- The user's settled palette, broad admin/widget scope, and authorization to make design decisions are already recorded. Do not repeat discovery questions about them.

## 2. Evidence and limits

The previous Chrome review captured overview, inbox, bots, knowledge, usage, and widget at 1440px and 375px. Files live in the ignored `.hallmark/shots/review-*.png` directory.

Confirmed observations:

1. The mobile inbox carries a wide table and clips important conversation information.
2. The bots table also loses secondary information outside the narrow viewport.
3. Overview, bots, and the knowledge entry page look sparse and provide little guidance about the next task.
4. The widget's launcher styling and missing welcome message were fixed in the earlier working diff. These changes still need to survive the next pass.
5. The mobile widget capture shows the launcher overlapping the composer area. Check open-state launcher behavior and ensure close/send controls are visible and reachable.
6. The usage layout is coherent, but the chart needs clearer scale, labels, and treatment of small costs. The current `maxOf` floors every chart maximum at 1, which can flatten sub-dollar values visually.

Review limits:

- The local seeded demo backend was older than the frontend schema. A temporary browser response adapter was used for some captures. Those captures support composition review, not API or end-to-end correctness claims.
- Conversation detail showed loading/error states and has no reliable completed visual review yet.
- Settings, account, instance administration, deep bot configuration, source details, and all widget states have not received equivalent browser coverage.
- The temporary Vite proxy was restored. Do not depend on `/tmp/ailoom-review.cjs` or the old adapter for final acceptance.
- Dark tokens exist; a complete usable theme-switching flow has not been established by this review. Do not describe dark mode as shipped without confirming its entry point and coverage.

## 3. Working protocol and progress

Execute tasks in order. A task moves through **pending → active → implemented → verified → complete**. Mark its checkbox complete only when its acceptance criteria pass and evidence is recorded. If a check cannot run, record it as blocked or unverified rather than passed.

For every task:

1. Read this plan and the relevant source, tests, and design guidance.
2. Record the files to change and the starting behavior. Identify any unrelated working-tree edits.
3. Implement the entire task as one coherent batch, keeping existing handlers, permissions, API contracts, IDs, and navigation behavior.
4. Run the relevant targeted checks in section 7.
5. Inspect desktop and mobile together. Fix the discovered issues as one batch; make at most one confirming capture round unless a new functional failure warrants further investigation.
6. Record evidence and remaining issues in section 9. Update affected design notes.
7. Review the diff and create a focused commit when repository authorization and baseline ownership are clear. Stage explicit files; never sweep unrelated work into a commit.
8. Continue to the next task. A release or production deployment is a separate action from completing this plan.

### Progress board

| ID | Task | Depends on | Status | Evidence / commit |
| --- | --- | --- | --- | --- |
| P0 | Preserve and classify the current working diff | — | Complete | `890fe8d` checkpoint |
| P1 | Establish a current, reproducible browser baseline | P0 | Complete | Current API; inbox/detail capture, no response adapter |
| P2 | Refine tokens, shared controls, and shell | P1 | Complete | `890fe8d`; admin build; current browser captures |
| P3 | Rebuild the responsive inbox queue | P2 | Complete | Mobile list + desktop table; 375px/1440px captures |
| P4 | Compose the conversation workspace | P3 | Next | — |
| P5 | Finish the customer widget and appearance preview | P2, P4 | Pending | — |
| P6 | Improve overview and bot setup | P2 | Pending | — |
| P7 | Improve knowledge, playground, and evidence inspection | P4, P6 | Pending | — |
| P8 | Improve usage and feedback reports | P2 | Pending | — |
| P9 | Complete settings, account, instance, and auth coverage | P2 | Pending | — |
| P10 | Final browser review, documentation, and handoff | P3–P9 | Pending | — |

The default execution order is P0 through P10. Dependencies identify what can proceed if one screen is temporarily blocked; they do not require parallel agents.

## 4. Baseline and foundation

### P0 — Preserve and classify the current working diff

**Read:** `git status --short`, `git diff --stat`, relevant full diffs, and new untracked design files.

- [ ] Record branch, HEAD, and the modified/untracked file list in the execution log.
- [ ] Classify the existing changes into admin design, widget design/fixes, shared/API default changes, and documentation.
- [ ] Inspect `apps/api/src/modules/bots/domain/bot-defaults.ts` and `packages/shared/src/bots.ts` specifically. Confirm default color changes affect new/default configuration without rewriting stored customer branding.
- [ ] Preserve the existing widget stylesheet and welcome-message fixes.
- [ ] Establish a recoverable baseline: checkpoint reviewed prior changes in a focused commit if already authorized; otherwise preserve a patch and untracked-file copies in an ignored local location before editing. Record their paths. Do not discard or stash work of uncertain ownership.
- [ ] Record which changes belong to the prior pass and which will be introduced by this plan.

**Acceptance:** Every existing changed file is accounted for, prior work is recoverable, and the next implementation diff can be distinguished from the current baseline.

### P1 — Establish a current, reproducible browser baseline

**Inspect:** `e2e/stack.ts`, `e2e/global-setup.ts`, `e2e/playwright.config.ts`, admin API clients, shared response schemas, and the repository's documented local startup procedure.

- [ ] Use the Node and pnpm versions declared in the current repository. Prefer `package.json` over older milestone prose if version references disagree.
- [ ] Start admin and API from compatible source revisions against an isolated development database. Use the mock model provider for repeatable review.
- [ ] Seed representative local data using the repository's supported process. Confirm isolation before any reset or migration.
- [ ] Open conversation detail and inspect the actual request, response, and schema validation failure if it still fails. Distinguish stale demo data from a current defect before changing code.
- [ ] Resolve a confirmed current defect in a narrow change; do not relax schemas to accommodate the old review adapter.
- [ ] Capture unmodified baseline screens at 1440×900 and 375×812 after data is ready. Add 768px and 1280px checks for the workbench transitions.
- [ ] Record startup commands, local route patterns, backend revision, seed method, and capture paths. Exclude credentials and session tokens from committed evidence.

**Acceptance:** Login, inbox, a populated conversation, and widget load with compatible real local responses. No response rewriting is needed for the acceptance environment.

### P2 — Refine the shared system and navigation

**Edit:** `apps/admin/src/tokens.css`, `base.css`, `styles.css`, `components/app-shell.tsx`, `components/native-select.tsx`, affected `components/ui/*`, and `routes/_app/w/$workspaceId/route.tsx`.

- [ ] Define consistent page-title, section-title, body, label, metadata, and numeric styles using the existing type family.
- [ ] Tune silver surface separation and borders so fields, lists, and panels have visible hierarchy without heavy outlines everywhere.
- [ ] Normalize control heights, spacing, focus, hover, selected, disabled, pending, and invalid states.
- [ ] Establish shared page-header, section, empty-state, and error-state patterns only where multiple real screens need them. Create small shared components rather than a new UI framework.
- [ ] Keep the product bar and workspace navigation; improve spacing and active state. At mobile widths, expose all destinations through an accessible menu or deliberate scroll treatment with clear affordance.
- [ ] Ensure long workspace names do not push the account menu or navigation off-screen.
- [ ] Define page widths: full workbench, medium reporting/list layout, and narrow settings form. Document how each route selects its layout.
- [ ] Add only purposeful transitions and verify reduced-motion behavior.

**Acceptance:** At 320px through 1920px there is no page-level horizontal overflow. Required controls remain accessible. Long names wrap or truncate with access to the full value. Keyboard focus is visible and not hidden by sticky bars.

## 5. Core support experience

### P3 — Rebuild the responsive inbox queue

**Edit:** `features/conversations/components/inbox.tsx`, `conversation-list.tsx`, `inbox-filters.tsx`, `status-badge.tsx`, and conversation route files as needed. Keep filter ownership in the URL and the existing query client.

- [ ] Reduce the filter area's visual weight: search and common status choices lead; secondary bot, assignment, and priority filters remain available.
- [ ] Build rows with a stable reading order: customer identity, conversation state, latest message, timestamp, then assignment/bot/priority metadata.
- [ ] Replace raw UUIDs as the primary anonymous-customer label with an existing or approved neutral label; keep identifiers available in detail where useful.
- [ ] At mobile widths, render a readable stacked conversation list. Do not rely on hiding useful text with overflow clipping.
- [ ] Make navigation from a row explicit and keyboard accessible; avoid nested interactive elements inside an all-clickable row.
- [ ] Preserve search, filters, cursor pagination, notifications, and realtime updates. Clear or preserve cursors according to existing filter behavior.
- [ ] Differentiate initial loading, genuinely empty inbox, no filter matches, and failed request. Do not show an empty inbox as the explanation for a request error.
- [ ] Prepare selected-row styling and a compact queue variant for P4 without creating a second source of filter state.

**Acceptance:** At 375px, identity, state, message preview, and time are readable without horizontal scrolling. Filtering, pagination, and opening/back navigation retain their established behavior. Selected and focused rows are distinguishable.

### P4 — Compose the conversation workspace

**Edit:** `routes/_app/w/$workspaceId/conversations.tsx`, `conversations/index.tsx`, `conversations/$conversationId.tsx`; `conversation-detail.tsx`, `message-timeline.tsx`, `reply-composer.tsx`, `conversation-actions.tsx`, `contact-sidebar.tsx`, `internal-notes.tsx`; relevant trace presentation.

- [ ] Compose the existing route outlet and reusable queue into a desktop master/detail layout. Preserve direct conversation URLs and browser Back/Forward behavior; do not replace the routing system.
- [ ] Use three areas only when the viewport supports them: queue, conversation, and context. At intermediate widths make context collapsible; on mobile use separate list and detail screens with an obvious return action.
- [ ] Keep customer identity, status, assignee, priority, and available conversation actions together in a compact header.
- [ ] Establish distinct readable treatments for customer messages, AI responses, human replies, and internal notes. Use labels and structure as well as color.
- [ ] Attach source/trace entry points to the answer they explain. Preserve permission checks and all existing trace details.
- [ ] Place handoff summary and suggested replies where agents use them. Make AI-generated suggestions reviewable before sending; preserve their existing loading/failure/regeneration behavior.
- [ ] Keep composer actions visible without covering the last message. Preserve draft content while interacting with context controls where current behavior supports it.
- [ ] Keep saved replies, private notes, contact history, CRM links, assignment, takeover, handback, and close available with the same role restrictions.
- [ ] Add clear loading/error/retry presentation for the actual supported query behavior. Preserve concurrency/version checks and conflict feedback.

**Acceptance:** An agent can open a handoff, inspect its answer and sources, review context, reply, and return to the queue on desktop and mobile. Read-only users cannot mutate through the redesigned controls. Internal notes are visibly distinct from customer replies. Narrow layouts never squeeze the conversation into an unusable column.

### P5 — Finish the customer widget and appearance preview

**Edit:** `packages/widget/src/loader/{index,launcher}.ts`, `main/styles.css.ts`, `main/app.tsx`, relevant `main/ui/*`, `main/render/citations.tsx`, `main/i18n/en.json`; admin `features/bots/components/bot-appearance-form.tsx`.

- [ ] Inspect open/close ownership, launcher styles, and Shadow DOM stylesheets. Keep both launcher and panel styles intact when opening the widget.
- [ ] Define a balanced desktop panel height and clear mobile viewport behavior; respect safe areas and the on-screen keyboard.
- [ ] Make the close action and send action clearly visible. Ensure the launcher never obstructs an open panel or its composer.
- [ ] Refine header, welcome message, message spacing, citations, and feedback as one conversation design.
- [ ] Cover long messages, links, code, streaming, retry, handoff offer, email capture, unavailable state, and existing privacy controls.
- [ ] Preserve Enter-to-send and Shift+Enter behavior. Verify focus handling within the Shadow DOM and return focus to the launcher on close.
- [ ] Keep per-bot theme/text colors and left/right placement working. Check extreme configured color pairs and avoid silently replacing customer choices.
- [ ] Align the admin appearance preview with the actual widget geometry and typography. Keep illustrative preview content clearly separate from real conversations.
- [ ] Build the widget and check its existing bundle-size budget.

**Acceptance:** At 375px the welcome, messages, close control, and composer are usable without overlap. Desktop placement works on both sides. Keyboard users can open, use, and close the widget. The widget does not inherit unrelated host-page styling or style its host page.

## 6. Remaining admin surfaces

### P6 — Overview and bot setup

**Edit:** `routes/_app/w/$workspaceId/index.tsx`, `features/bots/components/*`, bot route layouts, and relevant strings.

- [ ] Make overview lead with existing handoff counts and the next useful action. Use existing query data for any recent-conversation content; do not invent new aggregate metrics.
- [ ] Give a new workspace a clear route into existing bot creation and configuration actions, without pretending to know completion state that the API does not expose.
- [ ] Recompose the bot list for small and large collections; make its mobile representation readable. Move technical values to secondary positions while retaining access.
- [ ] Standardize bot tabs and form sections: general, model, instructions, behavior, appearance, install, knowledge, and playground.
- [ ] Improve the install snippet's readability, copy feedback, and narrow-screen handling. Preserve its actual content and escaping.
- [ ] Make validation, saving, saved, and failed states visible across bot forms. Keep role restrictions.

**Acceptance:** A new admin can find bot creation, configure an existing bot, preview its appearance, and locate the install snippet. A workspace with one bot feels intentional; a long list remains scannable.

### P7 — Knowledge, playground, and evidence inspection

**Edit:** knowledge route entry; `features/knowledge/components/*`; `features/playground/components/*`; `features/traces/components/trace-drawer.tsx`.

- [ ] Clarify bot selection on the workspace knowledge entry page and the route into its sources. Do not fill sparse pages with decorative statistics.
- [ ] Give source name, ingestion state, warnings, and available actions a clear hierarchy. Preserve file/URL upload and supported source actions.
- [ ] Cover queued, processing, ready, failed, empty, and warning states using real backend state labels.
- [ ] Make source details and document reading usable with long filenames, URLs, extracted content, and errors.
- [ ] Organize retrieval testing and playground as input, answer, and available evidence. Keep the tested bot and model context clear.
- [ ] Make trace details progressively accessible while retaining all existing information and permissions.

**Acceptance:** An admin can add a source, understand its ingestion result, inspect a document, test retrieval, and inspect an answer. Mobile controls and long technical text remain usable.

### P8 — Usage and feedback reports

**Edit:** `features/usage/components/{usage-report,usage-totals,usage-chart,unanswered-report,feedback-report}.tsx`, usage route navigation, and strings.

- [ ] Keep the date range and bot filter visually grouped and understandable on narrow screens.
- [ ] Prioritize existing measures; use consistent numeric alignment and cost precision without hiding meaningful small costs.
- [ ] Correct chart scaling for small positive values and all-zero data. Add readable date/value context and retain the accessible table alternative.
- [ ] Check long date ranges and many points for clipping or misleading bar widths.
- [ ] Improve unanswered-question and negative-feedback lists so users can reach the existing relevant detail/action.
- [ ] Distinguish no activity from failed loading. Preserve UTC bucket semantics and existing denominators.

**Acceptance:** A sub-dollar cost series is visibly interpretable, zero data is honest, and chart/table views agree. Filtering remains functional. No new analytics claims or calculations are introduced without an explicit requirement.

### P9 — Settings, account, instance, and authentication

**Edit:** settings layout; feature components under `workspaces`, `members`, `credentials`, `integrations`, `saved-replies`, `audit`, `account`, `instance`, and `auth`; shared auth card where needed.

- [ ] Fix overflow in settings and bot subnavigation. Preserve every permitted destination.
- [ ] Use consistent section headings, explanatory copy, field spacing, save feedback, and inline errors.
- [ ] Give member/invitation, credential, integration, saved-reply, and audit lists readable narrow-screen treatments.
- [ ] Preserve credential redaction, scope labels, verification/test results, connection states, and destructive-action confirmations.
- [ ] Separate dangerous actions visually and keep their existing permission and confirmation requirements.
- [ ] Review account profile, password, active sessions, workspace creation/leave, instance diagnostics, login, signup, password reset, email verification, and invitations.
- [ ] Ensure long error messages, provider names, addresses, and configuration values do not break layout.

**Acceptance:** Every existing admin route receives a recorded review. Forms remain labeled and usable by keyboard. Admin-only controls remain protected. Secret fields stay redacted. Loading, empty, validation, save-success, and failure states are understandable.

## 7. Verification procedure

These checks are planned for implementation. Writing this document does not constitute running or passing them.

### Source checks

Run from the repository root after the affected package changes:

```sh
pnpm --filter @app/admin lint
pnpm --filter @app/admin typecheck
pnpm --filter @app/admin build
pnpm --filter @app/widget lint
pnpm --filter @app/widget typecheck
pnpm --filter @app/widget build
pnpm --filter @app/widget size
git diff --check
```

Run formatting on the explicit changed files, then check those files. Build workspace dependencies first if package scripts require their generated output. Use whole-repository checks at the final checkpoint if shared configuration or cross-package changes warrant them; record unrelated existing failures separately.

### Targeted behavioral checks

Use existing tests for changed behavior, adding regression tests only for meaningful defects or new interaction behavior. Do not write tests that merely repeat CSS classes.

```sh
pnpm --filter @app/admin test src/features/conversations/inbox.spec.tsx src/features/conversations/detail.spec.tsx
pnpm --filter @app/widget test src/loader/loader.spec.ts src/main/ui/panel.spec.tsx
pnpm --filter @app/admin test src/features/bots/bots.spec.tsx src/features/knowledge/knowledge.spec.tsx src/features/playground/playground.spec.tsx
pnpm --filter @app/admin test src/features/usage/usage.spec.tsx src/features/settings.spec.tsx src/features/auth/auth.spec.tsx
```

Use additional existing feature tests for any affected integrations, credentials, diagnostics, saved replies, or verification logic. Run each relevant group at its task checkpoint; do not repeat it without a changed dependency or unresolved concern.

Before browser flow tests, inspect the E2E stack lifecycle: its setup and teardown manage an isolated stack, and the suite is configured serially because flows share database state. Confirm whether the chosen files require earlier flows before narrowing the run. Run the full `pnpm e2e` suite at the integration checkpoint when the stack is available and isolated; never point its reset/teardown at a personal or production database.

### Browser evidence matrix

| Surface | Required states | Widths |
| --- | --- | --- |
| Shell and navigation | Long workspace name, active destination, menu and keyboard focus | 320, 375, 768, 1280, 1440, 1920 |
| Inbox | Populated, no results, empty, loading, error, pagination, selected row | 375, 768, 1280, 1440 |
| Conversation | AI, needs-human, human, closed; sources; notes; role restrictions; loading/error | 375, 768, 1280, 1440 |
| Widget | Closed/open, welcome, streaming, long message, citation, handoff, retry, unavailable | 375, 1440; mobile keyboard inspection |
| Bot and knowledge | One/many records, long names, pending ingestion, error, appearance preview | 375, 1440 |
| Reports | Empty, zero, very small cost, long date range, chart and table | 375, 1440 |
| Admin forms and auth | Empty, validation error, saving, saved, failed, restricted role | 375, 1440 |

Capture screenshots after the intended state has loaded, not after a blind short delay. Label intentional fixture states. Use browser-derived real local data for integration evidence; clearly label isolated component fixtures.

Check text contrast, visible focus, logical tab order, dialog focus/escape/return behavior, accessible names, keyboard selection, zoom/reflow, and reduced motion. Target WCAG AA contrast, at least 44px touch targets for primary mobile controls, and no inaccessible content masked by overflow clipping. Distinguish desktop viewport emulation from a real mobile keyboard/device check.

Run Hallmark's app-scope static/render review and Impeccable's detector using the installed skill guidance. Record exact commands and findings. Authenticated screens need an authenticated capture path; a clean login screenshot does not prove the admin passed. Resolve tool findings with judgment and documented reasons rather than inventing pass counts.

## 8. P10 — Final completion and handoff

- [ ] Recheck the core path: configure bot → add/inspect knowledge → test an answer → open widget → ask → hand off → agent inspects and replies.
- [ ] Complete the remaining browser evidence matrix and record any unavailable state/device checks honestly.
- [ ] Review the entire final diff for accidental API changes, removed controls, customer branding overrides, secret leakage, and unrelated edits.
- [ ] Update `DESIGN.md` with the actual responsive layouts, component states, and widget rules. Update skill records only where actual outcomes changed.
- [ ] Replace outdated documentation screenshots only with current, verified captures; clearly retain demo labeling.
- [ ] Confirm no temporary proxy, response shim, public preview file, session data, or capture helper was accidentally committed.
- [ ] Record checks, known limitations, commit references, and any follow-up work below.
- [ ] Mark the plan complete only when all required tasks are verified. If a blocker remains, keep its task open with the exact next action.

**Completion criteria:** The main customer and agent flows work at desktop and mobile widths; every existing admin area has consistent visual treatment and state coverage; source evidence remains connected to answers; the widget is independently usable and brand-configurable; relevant checks pass; and browser evidence demonstrates the implemented result.

## 9. Execution log and handoff template

Append one entry per completed task or material blocker:

```text
Date / task ID:
Status:
Starting revision and baseline reference:
Changed files:
User-visible outcome:
Checks run and results:
Browser routes, state, viewport, and screenshot paths:
Remaining issue or scope adjustment, with reason:
Commit reference, if created:
Next task and exact first action:
```

### Initial entry — 2026-11-19

- Status: P0 complete; P1 is next.
- Starting revision: `856e1b3` on `feat/m9-agent-productivity`, synced with `origin/feat/m9-agent-productivity`.
- Baseline checkpoint: `890fe8d` (`feat(ui): introduce Answer Ledger design system`), signed off.
- Inventory: 38 tracked UI/API/docs changes plus new design tokens, product/design docs, Hallmark/Impeccable records, and this plan. The changes form the Answer Ledger visual-system pass across admin and widget; no unrelated tracked edits were found.
- Pre-commit evidence: repository hooks passed Prettier, ESLint, commitlint, and sign-off. Earlier task checks recorded in the prior session: admin build/lint/typecheck, widget build, and API/shared builds passed. This checkpoint does not mean the redesign is fully polished; the mobile inbox and conversation-detail review remain open.
- Current evidence: Earlier browser captures in `.hallmark/shots/`, with limitations documented in section 2.
- Current repository condition: Prior UI redesign changes are preserved in the baseline checkpoint. The branch now has one local commit beyond its starting revision; it has not been pushed by this task.
- Checks in this planning task: Source and script inspection only; no application tests or browser runs were required to create the plan.
- P1: Current-branch admin/API images ran in isolated stack `ailoom-e2e`. Seeded 12 conversations, 15 traces, and 30 usage days. Login, inbox, conversation detail, and internal notes returned successfully without a response adapter. The earlier detail error came from the old demo API mismatch. Captures: `.hallmark/shots/current-inbox-{1440,375}.png` and `.hallmark/shots/current-conversation-{1440,375}.png`.
- P1 widget note: The E2E host port 8090 is bound by an unidentified local process, so Compose could not publish its host there. This does not block admin review; widget review remains in P5. Do not stop an unidentified process.
- P2: Existing Answer Ledger shell and shared design system from `890fe8d` are the foundation for the responsive inbox. The admin production build passed after the inbox change.
- P3: At widths below `md`, conversations now render as touch-sized linked rows with contact, timestamp, latest message, status, priority where applicable, bot, and assignee. At `md` and above, the existing table remains. Browser captures at 375px and 1440px show the intended layouts; the mobile page no longer clips the table.
- Changed files in this slice: `apps/admin/src/features/conversations/components/conversation-list.tsx` and this plan's progress board/log.
- Checks: `pnpm --filter @app/admin build` passed. Browser login, current API requests for inbox/detail/notes, and visual capture passed. No test suite was run.
- Next task: P4. Recompose the desktop inbox/detail workbench and mobile conversation flow while preserving routes, actions, and permission behavior.

## 10. Resume instructions

At the start of a later session, read this file, `PRODUCT.md`, `DESIGN.md`, and repository instructions; inspect `git status` and the execution log. Resume the first incomplete dependency-ready task. Check the actual working tree before assuming any saved status is current. Use the documented evidence and settled palette instead of restarting discovery. Report progress briefly and keep this plan updated as implementation proceeds.
