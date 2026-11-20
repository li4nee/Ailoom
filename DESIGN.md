---
name: AiLoom
description: A support answer ledger for grounded AI and human handoffs.
colors:
  charcoal: 'oklch(20% 0.008 150)'
  charcoal-rail: 'oklch(20% 0.008 150)'
  silver-canvas: 'oklch(96.5% 0.004 260)'
  silver-surface: 'oklch(99% 0.002 260)'
  silver-rule: 'oklch(85% 0.006 260)'
  lime: 'oklch(84% 0.16 125)'
  lime-deep: 'oklch(53% 0.12 130)'
  warning: 'oklch(96% 0.018 90)'
  error: 'oklch(49% 0.18 28)'
typography:
  display:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1.875rem'
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: '-0.025em'
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: '0.5rem'
  md: '0.625rem'
  lg: '0.75rem'
spacing:
  xs: '8px'
  sm: '12px'
  md: '16px'
  lg: '24px'
  xl: '40px'
components:
  button-primary:
    backgroundColor: '{colors.lime}'
    textColor: '{colors.charcoal}'
    rounded: '{rounded.sm}'
    padding: '0 16px'
    height: '40px'
  button-secondary:
    backgroundColor: '{colors.silver-surface}'
    textColor: '{colors.charcoal}'
    rounded: '{rounded.sm}'
    padding: '0 16px'
    height: '40px'
  card-ledger:
    backgroundColor: '{colors.silver-surface}'
    textColor: '{colors.charcoal}'
    rounded: '{rounded.lg}'
    padding: '20px'
---

# Design System: AiLoom

## Overview

**Creative North Star: “The Answer Ledger”**

AiLoom should make a support answer feel traceable from the customer's question through the
knowledge that grounded it, the AI response, and the agent's next action. The admin is a working
console for operators and support agents. Its visual character comes from clear records, precise
hierarchy, and calm surfaces, not decorative dashboard chrome.

Charcoal anchors the shell and primary text. Silver separates the page, panels, and rules. Lime is
reserved for primary actions and the few states that need a clear signal. Customer widget themes
stay configurable per bot. **Key Characteristics:** grounded, composed, legible, action-oriented.

## Colors

The charcoal, silver, and lime palette is the owner's chosen direction. The exact token values live
in `apps/admin/src/tokens.css`; the YAML values above are portable mirrors of the active light theme.
The dark theme keeps the same roles and increases text contrast. Semantic warning, error, success,
and information colors remain separate from the brand accent.

**The Lime Signal Rule.** Use lime for the primary action, selected control, or a meaningful positive
state. Keep large working surfaces silver and text charcoal.

## Typography

Use the native system sans stack for both display and body text. It loads immediately, stays
consistent with the platform, and avoids a remote font dependency. Page titles use a compact,
semibold 30px scale; body copy stays at 16px with a 1.55 line height. Metadata is smaller but remains
readable and sentence case.

**The Working Type Rule.** Use weight, spacing, and alignment to establish hierarchy; reserve
monospace for code, identifiers, and measurements.

## Layout

The signed-in shell uses a charcoal product bar followed by a silver workspace navigation rail.
Keep the working area wide enough for conversation records and evidence, while settings forms use a
narrower readable measure. At small widths, keep workspace navigation reachable and reflow dense
records into stacked cards before their values become too narrow to read. Settings subnavigation
uses a two-column list so every destination stays visible without a hidden tab strip. Conversation
rows prioritize the customer, current state, and latest message before secondary metadata. At wide
desktop sizes, conversation detail places a compact queue rail beside the active thread and customer
context. On narrow screens, the queue and detail remain separate routes.

## Elevation & Depth

Panels are defined by silver rules and a slight ambient shadow. Use one containment layer for each
working group. Avoid stacking cards inside cards; separate related records with whitespace, hairlines,
or tonal changes instead. The signed-out auth card may use deeper separation from its background so
the form remains easy to find.

## Shapes

Controls use gently rounded corners (8px), panels use a slightly softer radius (12px), and the
workspace shell stays square-edged. Focus is always visible. Lime remains a signal color, not a
surface fill behind long text.

## Components

### Buttons

- Primary actions use a lime fill, charcoal label, and 40px minimum height.
- Secondary actions use a silver surface and a thin border.
- Ghost actions stay quiet until hover or keyboard focus. All variants retain a visible focus ring.

### Cards / Containers

- Working panels use a silver surface, thin silver rule, 12px corners, and restrained shadow.
- Keep content hierarchy inside the panel; do not nest another card for decoration.

### Inputs / Fields

- Fields use a silver background, thin rule, 8px corners, and comfortable 40px height.
- Focus increases the lime-tinted outline; invalid state uses the semantic error color.

### Navigation

- The product bar is charcoal with silver text. Workspace navigation is a light silver rail.
- Active workspace links use charcoal fill and high-contrast text; keyboard focus remains distinct.
- At narrow widths, preserve all navigation items with horizontal scrolling.
- Use two-column grids for bot setup and workspace settings destinations at narrow widths. Show the
  active tab with a pale lime surface and a clear underline.
- Use stacked cards for member, invitation, credential, audit, and report records when a table
  would squeeze their values.

### Authentication

- Signed-out forms use a charcoal title band and a silver content surface; the primary action carries the lime signal.
- Keep the form centered, single-column, and comfortable to use on narrow screens.

### Answer Ledger

- Conversation lists read like records: concise identity, state, latest message, and time.
- A selected conversation leads into its timeline, handoff context, and customer details.
- Evidence and trace information stay adjacent to the answer they explain.
- Saved reply text keeps its full reading width; edit, reorder, and archive actions move below the
  text on narrow screens and beside it when the desktop layout has room.

### Customer widget

- Hide the launcher while the conversation panel is open so it cannot cover the composer.
- Keep launcher styles scoped inside the widget's shadow root; closing returns keyboard focus to the
  launcher.
- Match the admin appearance preview to widget panel geometry while keeping sample content separate
  from a real conversation.

## Do's and Don'ts

### Do:

- **Do** keep the question, evidence, answer, and agent action easy to follow.
- **Do** use lime sparingly for actions and meaningful state.
- **Do** preserve each bot's configured widget color and contrast color.
- **Do** keep visible focus, semantic labels, responsive behavior, and reduced-motion support.

### Don't:

- **Don't** add decorative metric tiles or generic dashboard hero sections to working screens.
- **Don't** use lime as a large reading surface or as the only carrier of status meaning.
- **Don't** flatten conversation context into a generic table that hides handoff and evidence.
- **Don't** replace customer-configured widget branding with the admin palette.
