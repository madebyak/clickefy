# Clickefy Web

The professional **web** surface for Clickefy — an AI image & video creator studio
(the "Higgsfield-style" product), alongside the existing mobile app and admin dashboard.

This app lives in the monorepo but is developed in **isolation**:

- **Branch:** `feat/web` (never merged to `main` until the client signs off).
- **Deployment:** its own **separate Vercel project** (Production Branch = `feat/web`,
  Root Directory = `apps/web`) so production `admin` / `api` / `mobile` are untouched.
- **Nothing on `main` changes** while this is built.

## What this app will hold

One Next.js app, two audiences, organized by route groups:

| Route group | Purpose | Status |
| --- | --- | --- |
| `app/(marketing)` | Public landing + `/privacy` + `/account-deletion` (Apple review site, go-live item C3) | Planned |
| `app/(studio)` | The pro creator app: create image/video, storyboard, projects, billing | Planned |
| `app/design-system` | Living design-system reference page | Next up |

## Stack (mirrors `apps/admin`)

- **Next.js 16.2.2** (App Router, Turbopack), **React 19.2.4**
- **Tailwind CSS v4** (CSS-first, no `tailwind.config`)
- **shadcn** (`base-nova` style) on **Base UI**, **lucide** icons
- **next-themes** (light/dark), **sonner** (toasts)
- Shared TS config via `@clickfy/tsconfig/nextjs.json`

## Run it

```bash
pnpm install                 # from repo root, once
pnpm --filter @clickfy/web dev   # http://localhost:3001
```

Other scripts: `build`, `start`, `lint`, `typecheck`, `clean`.

## Ground rules

- **Front-end only right now** — no API/Clerk/Stripe wiring yet. Env stubs live in `.env.example`.
- **Don't touch** `apps/admin`, `apps/api`, `apps/mobile`, or `packages/*`.
- When integration starts, import the existing shared packages
  (`@clickfy/sdk`, `@clickfy/types`, `@clickfy/providers`) rather than re-implementing.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md),
and [CONVENTIONS.md](./CONVENTIONS.md).

## Troubleshooting

### `pnpm install` fails with `Cannot find matching keyid`

This is a **Corepack** bug, not a project issue. This repo pins `pnpm@10.13.1`, and
Corepack verifies pnpm's download signature before running it. Older Corepack
(≤ 0.30.0, bundled with Node 22.13) carries stale signing keys and rejects the
(valid) pnpm download.

Once pnpm 10.13.1 is cached locally, Corepack stops re-verifying, so day-to-day
`pnpm` works fine. If a cache clear or a version bump brings the error back, fix
Corepack itself (has the up-to-date keys):

```bash
# Permanent fix — updates the global Corepack (needs write access to the Node install)
sudo npm install -g corepack@latest

# One-command escape hatch if you can't update Corepack right now:
COREPACK_INTEGRITY_KEYS=0 pnpm install
```
