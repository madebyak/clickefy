# Design System — Clickefy Web

**Living reference:** the `/design-system` route in the app (run `pnpm --filter @clickfy/web dev` → http://localhost:3001/design-system).
**Source of truth for tokens:** `app/globals.css`. Never hard-code values in components — use tokens/utilities.

## Colors — black-first

| Role | Token | Hex |
| --- | --- | --- |
| Background (main) | `--background` | `#000000` |
| Surface 1 (subtle raise) | `--surface-1` | `#0A0A0C` |
| Surface 2 (cards) | `--surface-2` | `#131317` |
| Surface 3 (elevated/popovers) | `--surface-3` | `#1C1C22` |
| Foreground | `--foreground` | `#FAFAFA` |
| Muted text | `--muted-foreground` | `#9B9BA4` |
| **Green — primary** (buttons) | `--brand-green` | `#42D676` (black text on it) |
| **Purple — secondary** | `--brand-purple` | `#6303E0` |
| Turquoise — accent | `--accent-turquoise` | `#00DCAE` |
| Pink — accent | `--accent-pink` | `#DB0078` |
| Red — status/destructive | `--status-red` | `#EF0744` |
| Green — status/success | `--status-green` | `#07DD44` |
| Border / input | `--border` / `--input` | `#26262D` |
| Focus ring | `--ring` | `#42D676` |

Utilities: `bg-background`, `bg-surface-2`, `bg-brand-green`, `text-accent-turquoise`, etc.
shadcn semantic tokens (`--primary`, `--card`, `--muted`…) are wired so shadcn components inherit the theme. Light mode is deferred (theme is forced dark/black).

## Typography — Geist

- **Sans:** Geist (UI). **Mono:** Geist Mono (values, code, technical labels). Loaded via `next/font` in `layout.tsx`.
- **Scale** (Tailwind text sizes): Display 60 · H1 36 · H2 30 · H3 24 · H4 20 · Large 18 · Body 16 · Small 14 · Caption 12.
- **Weights:** Light 300 · Regular 400 · Medium 500 · Semibold 600 · Bold 700.

## Spacing — 4px atom / 8px rhythm

- Base unit `--spacing: 0.25rem` (4px). Numeric utilities derive from it: `p-2`=8px, `p-4`=16px, `p-6`=24px…
- Named tokens: `3xs` 2 · `2xs` 4 · `xs` 8 · `sm` 12 · `md` 16 · `lg` 24 · `xl` 32 · `2xl` 48 · `3xl` 64 · `4xl` 96 (px). Use as `p-md`, `gap-lg`, etc.
- Fluid tokens for the **outer shell only**: `py-section`, `px-gutter` (clamp-based).
- Rules: 8px multiples for component-to-component spacing; 4px/12px only for tight in-component spacing; prefer `gap` over margins; never hard-code px.

## Breakpoints — mobile-first (min-width)

| Token | Min width | Target |
| --- | --- | --- |
| base | 0 | phones |
| `xs` | 480px | large phones / foldables |
| `sm` | 640px | landscape phones |
| `md` | 768px | tablet portrait |
| `lg` | 1024px | tablet landscape / small laptop |
| `xl` | 1280px | laptop / primary desktop |
| `2xl` | 1536px | large desktop |
| `3xl` | 1920px | ultrawide / 4K |

`xs` and `3xl` are added in `globals.css` (`--breakpoint-xs`, `--breakpoint-3xl`); the rest are Tailwind v4 defaults. Guidelines: mobile-first only; use **container queries** (`@container`) for resizable panels/components, viewport breakpoints for the app shell.

**The site shell is `mx-auto w-full max-w-site site-px`** — always that pair, never a hand-written width.

- `max-w-site` comes from `--container-site` (120rem / 1920px) in `@theme`. Tailwind v4 derives `max-w-*`/`w-*`/`min-w-*` from the `--container-*` namespace, so the number lives in one place.
- `site-px` is the gutter, growing 16 → 24 → 32 → 40 → 48px across sm/lg/xl/2xl. It uses `padding-inline`, so RTL is free.

They are two classes rather than one on purpose: `tailwind-merge` cannot know a custom utility sets max-width, so folding them together would silently break any future `cn("site-shell", "max-w-3xl")`.

This replaced fourteen hand-copied `max-w-[90rem]`s (1440px), which left ~240px of dead margin either side on a 1920px display. **Reading-width containers are a separate concern and must stay narrow** — legal pages and Settings keep `max-w-3xl`/`max-w-2xl`, because prose at 1800px is unreadable no matter how much room there is.

## Radius

Base `--radius: 0.75rem` → `rounded-sm` 7 · `rounded-md` 10 · `rounded-lg` 12 · `rounded-xl` 17 · `rounded-2xl` 22 (px).

## Icons — Phosphor

`@phosphor-icons/react` (matches the mobile app). Six weights: thin, light, regular, bold, fill, duotone. Import per-icon: `import { Sparkle } from "@phosphor-icons/react"`.

## Bilingual & RTL (AR / EN)

- **Languages:** English (LTR) + Arabic (RTL). `dir` is set on `<html>` per locale.
- **Arabic font:** IBM Plex Sans Arabic (`--font-ibm-arabic`), loaded via `next/font` alongside Geist. The `--app-font-sans` stack is Latin-first by default and **Arabic-first under `[dir="rtl"]`** (see `globals.css`). Arabic glyphs fall back to the Arabic face even on LTR pages.
- **Author RTL-safe:** use Tailwind **logical** utilities — `ms/me`, `ps/pe`, `start/end`, `text-start/text-end`, `border-s/e`, `rounded-s/e`. **Never** `ml/mr/pl/pr/left/right/text-left/text-right`.
- **Mirror** directional icons (arrows, chevrons) with `rtl:-scale-x-100`; **never** flip logos, checkmarks, avatars, media, up/down carets.
- **Watch** transforms, box-shadows, and hardcoded left/right — they don't auto-flip (the Switch thumb uses `ltr:translate-x-5 rtl:-translate-x-5`).
- **Arabic type:** line-height ~1.75, `letter-spacing: 0`, no all-caps. Test real Arabic strings (they run ~20–30% different in length).
- **Routing (later):** full next-intl `/en` · `/ar` routing + message catalogs land when we build real app pages. The `/design-system` header has a live LTR/RTL toggle to preview now.

## Components

Built on the tokens above (CVA + `cn`), themed, accessible, RTL-safe. In `components/ui/`:

- **Button** — variants `primary` (green), `secondary` (purple), `outline`, `ghost`, `destructive`; sizes `sm/md/lg/icon`; icon support.
- **Badge** — `default`, `green`, `purple`, `turquoise`, `pink`, `outline`, `success`, `danger`.
- **Input**, **Textarea** — bordered fields with focus ring.
- **Switch** — accessible toggle (`role="switch"`), RTL-aware thumb.
- **Checkbox** — accessible (`role="checkbox"`) with Phosphor check.

More components land here as the studio is built. All render live in the `/design-system` Components section.

## Assets (drop into `public/`)

See [../public/README.md](../public/README.md) for exact filenames the `/design-system` page expects (logo, favicons, model logos, OG image).

---
_Research basis: Tailwind v4 responsive/spacing docs, MDN container queries, 8-point-grid & Geist references (2025–2026)._
