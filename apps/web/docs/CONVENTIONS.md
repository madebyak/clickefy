# Conventions — Clickefy Web

Mirror the existing `apps/admin` conventions so the codebase stays coherent.

## Structure
- `app/` — routes only (App Router). Group by audience with route groups.
- `components/` — shared components; `components/ui/` for shadcn primitives.
- `lib/` — helpers (`lib/utils.ts` exports `cn`). Import via `@/…` alias.
- `hooks/` — reusable hooks.
- Colocate route-specific pieces in the route folder; use `_folder` for non-routable.

## Styling
- Tailwind v4 utility classes + token `var(--…)` values. **No hard-coded colors.**
- Add shadcn components with the CLI: `pnpm dlx shadcn@latest add <component>`.
- Respect light + dark; test both.

## Components
- Server Components by default; add `"use client"` only when needed (state, effects,
  browser APIs, event handlers).
- Keep money/credit and API logic out of the front-end during this phase.

## TypeScript
- Extends `@clickfy/tsconfig/nextjs.json`. Run `pnpm --filter @clickfy/web typecheck`.
- Prefer explicit prop types; avoid `any`.

## Git / process
- Work on `feat/web` only. Do not stage files outside `apps/web`.
- Small, focused commits. Run `typecheck` + `lint` before committing.
