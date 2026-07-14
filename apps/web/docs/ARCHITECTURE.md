# Architecture — Clickefy Web

## Isolation model

```
monorepo (main)                     feat/web branch
├── apps/admin      ─ untouched     └── apps/web   ← this app, committed here only
├── apps/api        ─ untouched
├── apps/mobile     ─ untouched
├── apps/jobs-worker─ untouched
└── packages/*      ─ shared, imported read-only when integration begins
```

- The app registers automatically via the `apps/*` workspace glob and generic
  `turbo.json` tasks — **no edits to root config were required.**
- Production deploys build from `main`; this app is not referenced by anything on
  `main`, so it cannot affect them.

## Planned routing (App Router)

```
app/
├── layout.tsx                 # root: fonts + theme provider + toaster
├── page.tsx                   # temporary scaffold home
├── design-system/             # living style guide (built next)
├── (marketing)/               # PUBLIC — no auth
│   ├── layout.tsx
│   ├── page.tsx               # landing
│   ├── privacy/page.tsx       # Apple review requirement (C3)
│   └── account-deletion/page.tsx
└── (studio)/                  # PRO APP — behind auth (added at integration)
    ├── layout.tsx             # app shell: sidebar, credits, nav
    ├── create/                # text→image, image→video, start/end frame
    ├── storyboard/            # multi-shot sequencing
    ├── projects/              # workspace + asset library
    └── billing/               # Stripe plans + credit top-ups
```

## Integration seams (later, not now)

| Concern | Approach when we get there |
| --- | --- |
| Auth | Clerk (`@clerk/nextjs`), `proxy.ts` (Next 16's renamed middleware) |
| Data | `@clickfy/sdk` HTTP client → existing Worker API at `NEXT_PUBLIC_API_URL` |
| Types | `@clickfy/types` (shared, zero-dep) |
| Models/capabilities | `@clickfy/providers` capability registry |
| Billing | Stripe (web) feeding the existing credit ledger; reconcile with RevenueCat |
| Images | `next.config.ts` → `images.remotePatterns` for R2/Worker hosts (copy admin) |

## Deployment

Separate Vercel project:
- **Root Directory:** `apps/web`
- **Production Branch:** `feat/web`
- **Install Command:** `pnpm install` (monorepo-aware)
- Result: a private client-review URL, fully independent of production.
