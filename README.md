# Clickfy

AI-powered, template-driven content generator for product brands. Admins build the intelligence, end users only trigger it.

This is the **Clickfy monorepo** — three apps and shared packages, managed with **pnpm workspaces** and **Turborepo**.

---

## Repo layout

```
clickfy/
├── apps/
│   ├── admin/          Next.js 16 admin dashboard (was the original repo)
│   ├── api/            Hono on Cloudflare Workers — public mobile API
│   └── mobile/         Expo SDK 54 (iOS + Android) — end-user app
├── packages/
│   ├── types/          @clickfy/types — shared TypeScript interfaces
│   └── tsconfig/       @clickfy/tsconfig — shared TS preset configs
├── infra/
│   ├── cloudflare/     Wrangler / R2 / Stream config (placeholder)
│   └── trigger/        Trigger.dev tasks (placeholder)
└── docs/
    ├── ARCHITECTURE.md System design + complete API spec + Cloudflare vs AWS
    ├── SETUP.md        Local toolchain + accounts to create
    └── prd.md          Original product PRD
```

For the why behind the stack: read `docs/ARCHITECTURE.md`. For setting up your machine: read `docs/SETUP.md`.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 22 | `brew install fnm && fnm install 22` |
| pnpm | 10.13.1 | enabled automatically via `corepack` (see `packageManager` field) |
| Watchman | latest | `brew install watchman` (Metro bundler needs it) |
| Xcode | 16+ | App Store (only needed for iOS Simulator) |
| Android Studio | latest | `brew install --cask android-studio` (only needed for Android emulator) |
| Wrangler | bundled | comes via `pnpm install` in `apps/api` |

See `docs/SETUP.md` for the full guided checklist (Apple Developer enrollment, all the SaaS accounts, etc).

---

## Quick start

```bash
git clone <this repo>
cd clickfy
pnpm install
```

Then in three terminals (or one, run them all in parallel):

```bash
# Terminal 1 — admin dashboard on http://localhost:3000
pnpm dev:admin

# Terminal 2 — mobile API on http://localhost:8787
pnpm dev:api

# Terminal 3 — Expo dev server (then press i for iOS or a for Android)
pnpm dev:mobile
```

Or fire everything at once:

```bash
pnpm dev          # Turborepo runs all three in parallel
```

### Smoke tests

```bash
curl http://localhost:8787/v1/health
curl http://localhost:8787/v1/catalog/templates
open http://localhost:3000               # admin dashboard
```

In the Expo terminal press `i` to launch the iOS Simulator and you should see the Clickfy home screen pulling templates from the local API.

---

## Project scripts (root)

| Script | What it does |
|---|---|
| `pnpm dev` | Run all 3 apps in parallel (admin + api + mobile) |
| `pnpm dev:admin` / `pnpm dev:api` / `pnpm dev:mobile` | Just one app |
| `pnpm build` | Production build of all apps (uses Turbo cache) |
| `pnpm typecheck` | Typecheck all workspaces |
| `pnpm lint` | Lint all workspaces |
| `pnpm clean` | Wipe build artifacts and node_modules |

Per-app scripts live in their `package.json`. Run any of them with the `--filter` flag, e.g.:

```bash
pnpm --filter @clickfy/admin build
pnpm --filter @clickfy/api deploy
pnpm --filter @clickfy/mobile ios
```

---

## How code is shared

`packages/types/` is the single source of truth for `Template`, `GenerationStage`, `Category`, `GenerationJob`, and friends. Both the admin and the API import from `@clickfy/types`. When you change a type, all three apps pick it up next typecheck.

Example — both files reference the same definition:

```ts
// apps/admin/components/templates/template-card.tsx
import type { Template } from '@clickfy/types';

// apps/api/src/routes/catalog.ts
import type { Template } from '@clickfy/types';

// apps/mobile/lib/api.ts
import type { Template } from '@clickfy/types';
```

We'll add more shared packages as they earn their place: `@clickfy/zod` (validation schemas), `@clickfy/sdk` (typed mobile/admin client), `@clickfy/prompt-engine` (`{{variable}}` resolver + provider capability registry).

---

## Where to make changes

| Want to… | Edit |
|---|---|
| Add or edit a template | The admin dashboard at `apps/admin/` |
| Add a mobile API endpoint | `apps/api/src/routes/` and the spec in `docs/ARCHITECTURE.md` §6 |
| Add a mobile screen | `apps/mobile/app/` (Expo Router file-based routing) |
| Add a shared type | `packages/types/src/` |
| Tweak a Tailwind/shadcn component used by admin | `apps/admin/components/ui/` |

---

## Status

This is **Phase 0 (foundation)** of the build plan in `docs/ARCHITECTURE.md` §16. What's working today:

- ✅ Monorepo wired (pnpm + Turborepo)
- ✅ Admin dashboard moved into `apps/admin/`, builds and runs unchanged
- ✅ Mobile API skeleton with health + mock catalog endpoint, runs locally on Workers
- ✅ Expo mobile app with React Query + dark theme + a home screen that fetches from the local API

Phase 1 (real database, auth, jobs, payments) is next.

---

## License

Private — all rights reserved.
