# M18 Prompt release workflow

Status: Implemented and verified locally on `feat/m18-prompt-release`.

## User flow

1. Open a bot’s Instructions tab and save a draft with an optional change note.
2. Compare the draft with the live prompt or another saved version. Version history identifies
   the live prompt using the bot’s active version ID.
3. Open Evaluate with the exact saved version selected. If the bot has a release gate, start with
   its required dataset. Review the results and return to Instructions.
4. Review the gate result and confirm publication. Restore an earlier version from the same
   screen when needed. Both actions use the existing gate and the owner override with an audit
   reason.

## Implementation

- Reuse immutable prompt versions and the bot’s active version pointer. The Instructions editor
  saves with `activate: false`. Preserve compatibility for callers using the existing API.
- Report the current gate decision for the selected version using the same rules as activation.
  Recheck the gate under a bot row lock and reject stale confirmation if another release changed
  the active version. Audit the previous and selected version IDs and the operation.
- Reuse the M15 evaluator and its existing sandboxed tool fixtures. Preserve exact prompt version
  IDs in the run and trace. Show the evaluated prompt in results and provide navigation back to it.
- Add a compact line diff, readable version history, and a confirmation dialog with inline
  errors. Keep the current live instructions visible while composing a draft.

## Acceptance

- Saving and evaluating a draft leaves live chat on the current version.
- A newer draft never looks live merely because it is first in version history.
- Owners and admins can publish or restore a selected version. The gate and role checks run on
  the server, and the reset to an earlier version preserves the original record.
- Traces retain the prompt version used when each answer was produced.

## Local validation

- Admin tests cover the live marker, draft saves, the line diff, and starting an evaluation
  with the selected draft ID.
- PostgreSQL end-to-end tests cover publication, restoration, stale confirmation,
  matching gate evidence, and workspace isolation.
- Shared build, API and admin type checks, lint for the changed code, and the docs build passed.
