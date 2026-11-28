# M25: Structured widget interactions

## Goal

Give visitors useful choices before they start typing while keeping every action authored and
controlled by a workspace admin.

## Scope and boundaries

- Admin-configured HTTPS cards with optional HTTPS images, horizontally scrollable as a carousel.
- Admin-configured quick replies, each with a visible label and fixed visitor prompt.
- One admin-configured form with up to five `text`, `email`, or fixed-option `select` fields.
- Strict shared schemas and storage bounds; no model-defined actions, URLs, schemas, or destinations.
- Quick replies and form answers use the existing visitor message endpoint and persistence path.
- Form values are conversation text and are processed by the configured AI/support workflow. The
  widget discloses this before submission; admins are warned not to request sensitive information.
- Responsive widget controls, keyboard-operable carousel, visible focus, native form semantics, and
  tests at phone and desktop viewport dimensions.

## Implementation sequence

1. Add strict shared schemas, a persisted bot JSONB configuration, DTO mapping, and public widget
   config delivery. Default every existing bot to no interactions.
2. Add an admin Interactions tab for editing cards, quick replies, and form fields. Keep the feature
   admin-only using the existing bot write authorization.
3. Render welcome interactions in the empty conversation state. Use safe external links, a native
   horizontal rail with previous/next controls, normal send for quick replies, and a plain-text form
   submission capped by the existing 2,000-character message limit.
4. Add accessibility/privacy tests and update README and widget documentation.
5. Run targeted tests, then lint, typecheck, unit/integration/E2E suites, migration checks and CI.

## Acceptance checks

- Existing bots receive empty interaction config without changing current behavior.
- Unknown schema keys, unsafe URLs, oversized collections, and invalid select definitions fail
  validation.
- Configured interactions render only in the welcome state; no AI output can invoke them.
- Quick reply text and labeled form answers become normal conversation messages; answer content is
  bounded and the visitor sees a disclosure before submitting.
- Keyboard navigation, screen-reader names, reduced motion, narrow viewport and desktop layout are
  covered by tests.
- Documentation describes what is available and the data flow honestly.
