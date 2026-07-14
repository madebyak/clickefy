# Design System — Clickefy Web

> Status: **to be built next.** This file will track design-system decisions;
> the living reference lives at the `/design-system` route in the app.

## Source of truth

- **Tokens** are defined once in `app/globals.css` (`@theme inline` + `:root` / `.dark`).
  Components consume `var(--…)` tokens — never hard-coded hex.
- The `/design-system` page renders every token and component so design and code
  stay in sync.

## Current base (placeholder — will be refined during design)

- **Accent:** violet (`#7c3aed` light / `#8b5cf6` dark) — matches Clickefy brand.
- **Neutral scale:** shadcn `neutral`.
- **Font:** Inter (sans) + JetBrains Mono (mono) — provisional; confirm during design.
- **Radius:** `0.75rem` base with `sm/md/lg/xl` steps.
- **Themes:** light + dark (dark default), class-based via `next-themes`.

## To decide during the design phase

- [ ] Final typography (typeface, scale, weights)
- [ ] Full color ramp + semantic tokens (success/warning/info, surfaces, overlays)
- [ ] Spacing & layout grid for the studio shell
- [ ] Component inventory (buttons, inputs, sheets, model picker, cards, etc.)
- [ ] Motion language
- [ ] Light vs dark emphasis for the pro app
