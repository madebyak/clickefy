# Web ↔ Backend Integration Plan

**Status:** Draft v1 — 2026-07-16
**Goal of Phase 1:** activate **Auth + Generate + Projects** on the web app with the real backend.

This document is the result of a full codebase study: the production backend (`apps/api`,
`packages/db`, `packages/sdk`, `apps/jobs-worker`), the finished mobile phase-1 integration
(`apps/mobile`), and the current frontend-only web app (`apps/web`).

---

## 1. Where we stand today

### Backend (production, live at `api.clickefy.ai`)
- Cloudflare Worker (Hono) + Neon Postgres (Drizzle) + Trigger.dev + R2. Production-grade.
- **Auth:** Clerk Bearer JWT verified offline (`CLERK_JWT_KEY`, checks only `sub`). It is
  client-agnostic — a Next.js app with `@clerk/nextjs` on the **same Clerk instance** can call
  every endpoint today. Users are lazily provisioned on first authed request (plus Clerk webhook).
- **CORS:** effectively allow-all (reflects any origin, Bearer not cookies). No blocker for web.
- **Generation:** two entry points, both live and battle-tested:
  - `POST /v1/jobs` — template jobs.
  - `POST /v1/jobs/create` — prompt-first create jobs (`source='user'`, model roster from
    `GET /v1/models`: Nano Banana Pro, Nano Banana 2, Kling 3 Omni, Kling 2.6, Seedance 2).
  - Poll `GET /v1/jobs/:id` (~1s) until `completed|failed`; outputs served from
    `GET /v1/outputs/:key` (public, immutable).
- **Credits:** bucket ledger (promo → subscription → topup), atomic CTE debit at job creation,
  `GET /v1/users/me` (`creditsBalance`, entitlement) + `GET /v1/credits/me` (per-bucket) +
  `GET /v1/credits/me/history`.
- **Billing:** RevenueCat only (native IAP webhook). **Zero Stripe code exists.** Web billing is
  entirely net-new (proposal §4.7, deferred here to a later phase).
- **Uploads:** presigned R2 PUT (`POST /v1/uploads/user/presign` → PUT → `finalize`), or
  multipart `POST /v1/uploads/user`.

### Mobile (phase 1 finished — the reference integration)
- One SDK singleton (`lib/sdk.ts`): `createHttpClient({ baseUrl, getToken, getLocale })` with a
  swappable `attachTokenGetter` fed by Clerk (`SdkBridge` in `_layout.tsx`).
- React Query everywhere; user bootstrap = `['users','me']` → `GET /v1/users/me`; everything that
  changes credits invalidates that key.
- Generation UX: submit → `/generating` (SDK `generation.subscribe` polling) → module output cache
  → `/result/[jobId]` (cold-fetch fallback for push deep-links).
- **Mobile "Projects" = flat job history (`GET /v1/jobs`).** No folders, no naming, no grouping,
  no moving content. The web's project model is a superset that does not exist anywhere yet.

### Web (`apps/web`, this app — frontend-only)
- Next.js **16.2.2** (App Router, `proxy.ts` instead of `middleware.ts`), React 19, Tailwind v4,
  next-intl EN/AR with full RTL. Routes: marketing `/`, studio `/create`, `/create-video`,
  `/projects`, plus `/design-system`.
- **Zero network layer.** No Clerk, no SDK, no react-query. Only workspace dep is
  `@clickfy/tsconfig`. All data is hardcoded:
  - `components/studio/studio-context.tsx` — in-memory Folders/Projects/Assets store + all
    mutations (create/rename project, folders, move/copy/delete assets, selection, attachments).
  - `components/generate/prompt-bar.tsx` — hardcoded models (incl. **Seedream, Veo 3** which the
    backend doesn't have), aspects, qualities (1K/2K/4K), durations, `CREDIT_COST=2`,
    `MAX_OUTPUTS=4`. **Generate button has no handler.**
  - Hardcoded user ("Ahmed Kamal / Pro") and credits (3450) in topbar/sidebar.
  - `templates-section.tsx` (15 fake templates), `pricing-section.tsx` (fake plans),
    `model-row.tsx` (fake homepage roster).

---

## 2. The gap map (web UI assumption → backend reality)

| Web UI assumes | Backend reality | Resolution |
|---|---|---|
| `Project { name, folderId, assets[] }`, folders, rename, move/copy assets between projects | **No projects/folders/assets tables at all.** Jobs are a flat per-user history; outputs live inside `jobs.result` | **Net-new schema + routes** (see §4) — the only real backend build in Phase 1 |
| Asset-level select/copy/move/delete | Outputs are embedded in a job row, not addressable rows | Materialize outputs as `project_assets` rows at job completion (recommended, §4) |
| Models: Nano Pro/2, Seedream, Kling Omni/2.6, Seedance, Veo 3 | `GET /v1/models`: Nano Banana Pro, Nano Banana 2, Kling 3 Omni, Kling 2.6, Seedance 2 | Phase 1: drive picker from the API, drop Seedream/Veo/GPT-Image from UI until adapters land (proposal week-2 scope, separate track) |
| Quality knob 1K/2K/4K | No resolution parameter anywhere in the pipeline | Hide in Phase 1 (or map to nothing); revisit with adapters |
| 1–4 outputs per generate | One output per create job | Submit N parallel jobs (N tiles, N polls) — matches Higgsfield UX anyway |
| `CREDIT_COST = 2` flat | Per-model `costCredits` (10–100), flat per job | Read from `/v1/models`; button shows `cost × count` |
| Hardcoded user + credits | `GET /v1/users/me`, `GET /v1/credits/me` | Wire directly (Phase 1A) |
| Fake template gallery | Public `GET /v1/catalog/*` (no auth needed) | Cheap win — can wire any time |
| Pricing page / buy credits | RevenueCat only, no Stripe | Later phase (billing) |
| No auth UI at all | Clerk prod instance `clerk.clickefy.ai` fully wired | `@clerk/nextjs` (Phase 1A) |

**SDK portability:** `packages/sdk` is plain `fetch`/XHR and works in the browser **except** the
upload methods (`uploads.uploadUserAsset`, `user.uploadAvatar`), which send React-Native
`{ uri, name, type }` bodies. Fix inside the SDK: accept `File | Blob` as an alternate
`UploadSource` and branch the body construction (presigned PUT with a real Blob; FormData with a
real File). Everything else (catalog, generation, library, models, notifications, store, user)
is reusable as-is.

---

## 3. Phase plan (overview)

| Phase | Scope | Backend work? |
|---|---|---|
| **0 — Foundation** | deps, env, SDK web-upload support, image remotePatterns, react-query provider | SDK-only (shared pkg) |
| **1A — Auth** | Clerk in `proxy.ts` + sign-in/up, studio gating, real user + credits in topbar/sidebar/profile menu | none |
| **1B — Generate** | prompt bar → `/v1/models` + presign upload + `POST /v1/jobs/create` + polling + assets in workspace | none |
| **1C — Projects** | `folders` + `projects` + `project_assets` schema, `/v1/projects` routes, `projectId` on create-job, rewire studio-context to server state | **yes — net-new** |
| **2 — Templates on web** | gallery from public catalog, run-template flow (`POST /v1/jobs`) | none |
| **3 — Billing (Stripe)** | checkout, webhook → credit ledger, RC reconciliation | yes |
| **4 — Storyboard / new model adapters (Seedream, GPT-Image)** | per proposal | yes |

Phases 1A and 1B have **zero backend changes** — the API already supports them fully.
Phase 1C is the only schema/API build and can proceed in parallel.

---

## 4. Phase 1C — the Projects data model (the one real design decision)

Recommended minimal schema that preserves the web UX **without touching the mobile money-path**:

```
folders          id, user_id, name, sort_order, created_at
projects         id, user_id, folder_id (nullable FK), name, created_at, updated_at
project_assets   id, project_id (FK cascade), user_id, job_id (FK SET NULL),
                 output_index, kind ('image'|'video'), r2_key/url, width, height,
                 poster_url, created_at
jobs             + project_id (nullable FK SET NULL)   ← only change to an existing table
```

- **Why asset rows:** the web UI's copy/move/delete operates on individual assets, and one job can
  yield multiple outputs. Materializing each output as a `project_assets` row at job completion
  (jobs-worker or lazily by the API on first read) makes copy = insert row, move = update
  `project_id`, delete = delete row — with the R2 object untouched and the job history intact.
- **Mobile is unaffected:** mobile keeps reading `GET /v1/jobs`; `project_id` stays null for
  mobile jobs (or later: auto-file into a default project — a product decision, not required now).
- **New routes** (`apps/api/src/routes/projects.ts`):
  - `GET /v1/projects` (with folders + counts + cover), `POST /v1/projects`, `PATCH /v1/projects/:id`
    (rename / move to folder), `DELETE /v1/projects/:id`
  - `GET /v1/projects/:id/assets` (paginated)
  - `POST /v1/projects/:id/assets` (copy in), `PATCH /v1/assets/:id` (move), `DELETE /v1/assets/:id`
  - `GET/POST/PATCH/DELETE /v1/folders`
  - `POST /v1/jobs/create` accepts optional `projectId` (validated as owned by user)
- **Migration discipline:** drizzle snapshot is drifted — write the SQL migration by hand and apply
  directly (same procedure as `0020_create_flow_jobs.sql`). Additive only; no destructive DDL.

Scope cut for v1 if needed: ship job-level filing only (`jobs.project_id`, assets derived from job
outputs at read time) and defer `project_assets` copy/move. **Not recommended** — the selection
bar UX is already built and asset rows are cheap.

---

## 5. Phase 0 + 1A + 1B — implementation checklist

### Phase 0 — Foundation
- [ ] `apps/web` deps: `@clerk/nextjs`, `@tanstack/react-query`, `@clickfy/sdk`, `@clickfy/types`
      (workspace). Verify `@clerk/nextjs` version supports Next 16 `proxy.ts` (clerkMiddleware
      export); check `node_modules/next/dist/docs/` for proxy conventions before writing code.
- [ ] `.env.local`: `NEXT_PUBLIC_API_URL=https://api.clickefy.ai` (or local worker :8787),
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (prod instance `clerk.clickefy.ai`;
      dev keys for dev).
- [ ] `packages/sdk`: extend `UploadSource` to accept `File | Blob`; branch presign-PUT and
      FormData bodies. Keep RN triple path byte-identical (mobile regression risk = zero).
- [ ] `next.config.ts`: `images.remotePatterns` for `api.clickefy.ai` (mirror `apps/admin`).
- [ ] `lib/api.ts` (web): SDK singleton + token-getter bridge (port of mobile `lib/sdk.ts` +
      `SdkBridge`), `QueryClientProvider` in studio layout, `useSession()` port
      (`['users','me']` key + invalidation contract).

### Phase 1A — Auth
- [ ] Clerk middleware composed with next-intl in `proxy.ts`; protect `(studio)` routes.
- [ ] Sign-in / sign-up pages (Clerk components, themed dark, AR/EN).
- [ ] Topbar/sidebar/profile menu: real `name/email/entitlement` from `/v1/users/me`; CreditMenu
      from `/v1/credits/me` buckets; sign-out; locale synced to `users.locale`.
- [ ] Landing navbar `authed` state from Clerk.

### Phase 1B — Generate
- [ ] Prompt bar: models from `GET /v1/models` (name, kind, costCredits, aspectRatios, durations,
      maxPromptChars, attachment mode). Remove hardcoded rosters/qualities. Enforce
      `maxPromptChars`. Image/video toggle filters `kind`.
- [ ] Reference/frame uploads: browser File → presign → PUT Blob → finalize → `r2Key`.
- [ ] Generate: build `CreateGenerationInput` (+ `idempotencyKey`), submit 1–N jobs
      (`count` = N parallel jobs), optimistic "generating" tiles in the masonry.
- [ ] Poll via `generation.subscribe(jobId)`; on complete, tile resolves to output(s); on fail,
      error tile + typed error toasts (`insufficient_credits` → credit menu/paywall stub).
- [ ] Invalidate `['users','me']` + credits after every submit.
- [ ] Until 1C lands: hydrate workspace from `GET /v1/jobs` (flat history, like mobile), keeping
      the projects UI on local state.

### Definition of done (Phase 1)
Sign in on web → upload a reference → generate with a real model → watch it complete → asset
appears in a named project → rename/move it → balance visibly debited → same job visible in the
mobile app's Projects tab (shared history), all in EN and AR/RTL.

---

## 6. Risks / open questions

1. **Clerk × Next 16 `proxy.ts`** — confirm supported pattern before Phase 1A (fallback: alias
   proxy to clerkMiddleware wrapper; read `node_modules/next/dist/docs/`).
2. **Projects semantics for mobile** — do mobile create-jobs auto-file into a default web project?
   Recommend: leave unfiled (null) in v1; web shows an "Unfiled" section (UI already has one).
3. **Multi-output cost UX** — N jobs = N debits; show `cost × N` and fail fast per-job on
   `insufficient_credits` (jobs are debited independently).
4. **Video thumbnails** — `project_assets.poster_url`: worker doesn't generate posters today;
   v1 can render `<video preload="metadata">` like the current masonry does.
5. **Seedream / GPT-Image / Veo** — in the signed proposal but require new provider adapters +
   pricing rows; keep as an independent track (Phase 4) so Phase 1 isn't blocked.
6. **CORS/tokens** — nothing needed now (allow-all + Bearer). Consider origin allow-list at launch.
