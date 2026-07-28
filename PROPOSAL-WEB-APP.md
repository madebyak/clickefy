# Proposal — Clickefy Web App (Professional Creator Platform)

**Prepared by:** MoonWhale
**Prepared for:** Clickefy.Ai — Cast U FZE LLC
**Date:** 12 July 2026
**Version:** 1.0
**Engagement type:** Fixed-scope, fixed-price
**Investment:** **$6,800 USD**
**Timeline:** **4 weeks** from kickoff

---

## 1. Executive Summary

Clickefy today is a polished, production-grade **mobile** AI generation product: users pick a template, upload a photo, and receive AI images and video. The intelligence lives in an admin-authored template engine, and the generation backend already runs on a serious, modern stack — Cloudflare Workers, Neon Postgres, Trigger.dev, and direct model adapters for Gemini, Kling, and Seedance, all sitting behind a bucket-aware credit ledger.

MoonWhale proposes to extend Clickefy to a **second surface: a professional web application** — a "Higgsfield-style" creator workspace aimed at power users, agencies, and professionals who work on a desktop and want direct, model-first control over image and video generation.

The central advantage — and the reason this can be delivered in **four weeks for $6,800** rather than a multi-month build — is that **the hard part already exists.** The generation engine, credit system, provider adapters, template catalog, and even a prompt-first "create from scratch" flow are already built and battle-tested inside the mobile product. This engagement is primarily about **building a new web front-end on top of the backend Clickefy already owns**, plus adding **web-native billing (Stripe)** so the web app can monetize independently of the app stores.

---

## 2. Background & Objective

The client's goal is to evolve Clickefy into a two-surface product:

- **Mobile app** — remains the simple, template-driven experience for everyday users.
- **Web app (this engagement)** — a professional workspace for advanced users, offering direct model selection (Gemini "Nano Banana", Kling video, Seedance image/video), create-image and create-video flows, projects, a template gallery, and a subscription + credits economy.

The reference product is **Higgsfield.ai**. Our research confirms Higgsfield is, at its core, an **orchestration layer over third-party models** (Kling, Seedance, Veo, Sora, Nano Banana, and others) — not a proprietary model house. Clickefy already operates the same kind of orchestration layer. This proposal delivers the professional web surface for it.

> **Note on the reference product:** This MVP includes a first version of Higgsfield's **Storyboard** feature. Higgsfield's other signature "power" features — Cinema-Studio camera controls and Soul-ID character consistency — remain a **Phase 2 roadmap** (Section 7). This engagement delivers the professional web foundation those later features build on.

---

## 3. What Clickefy Already Has (the head start)

MoonWhale's technical review of the existing codebase confirms the following assets are already in place and directly reusable by the web app:

| Capability | Status | Reused by web app |
| --- | --- | --- |
| Generation engine (compile → execute pipeline) | ✅ Built | Yes — unchanged |
| Provider adapters: Gemini, Kling, Seedance | ✅ Built | Yes — unchanged |
| Model capability registry (drives model-adaptive UI) | ✅ Built | Yes |
| Prompt-first "create from scratch" API | ✅ Built | Yes — powers web create flows |
| Credit ledger (bucket-aware, atomic, auditable) | ✅ Built | Yes — Stripe feeds into it |
| Template catalog + versioning | ✅ Built | Yes — same templates on web |
| Async job queue + polling (Trigger.dev) | ✅ Built | Yes — unchanged |
| Asset storage (Cloudflare R2) | ✅ Built | Yes — unchanged |
| Authentication (Clerk — already supports web) | ✅ Built | Yes |
| Next.js App Router expertise (admin dashboard) | ✅ In-house | Yes — same stack |

**Implication:** roughly 60–70% of the backend a Higgsfield-style web product needs is already operational. The MVP is a front-end and billing engagement, not a ground-up build — which is what makes the four-week timeline achievable.

---

## 4. Scope of Work (MVP — included in this engagement)

### 4.1 Professional Web Application
- New **Next.js (App Router)** web application, matching Clickefy's existing tech stack and design language.
- Responsive, desktop-first professional UI, reusing the in-house component and theming patterns already established in the admin dashboard.
- **Web authentication** via Clerk (sign up, sign in, session management) — shared identity with the existing platform.
- Light/dark theming and clean, modern creator-tool layout.

### 4.2 Create Image
- Model-first **text-to-image** and **image-to-image** generation, reusing the existing model registry.
- **One-click model switching** across image models — **Nano Banana / Gemini, Seedream, GPT-Image**, and Seedance image.
- Integration of **two new image-model adapters — Seedream and GPT-Image** — into the existing provider framework, so the web app ships with a broader model roster than mobile.
- Adaptive controls per model (aspect ratio, references, image count) driven by the existing capability registry.
- Reference-image upload.

### 4.3 Create Video
- **Text-to-video** and **image-to-video** generation via Kling and Seedance.
- **Start-frame / end-frame** conditioning where the model supports it.
- Live generation progress and queue status, powered by the existing job pipeline.

### 4.4 Storyboard
- A **multi-shot Storyboard** workspace — plan a sequence of shots (scenes) and generate each as part of a single project.
- Per-shot prompt, model, and reference selection, with **style and reference carry-through** across shots for visual continuity.
- Add, remove, and reorder shots; generate shots individually or as a batch through the existing job pipeline.
- Assemble and export/download the completed shot set from the project.

### 4.5 Templates
- Web-accessible **template gallery** using the client's existing published templates.
- Run any template from the browser with the same versioned, reproducible pipeline used on mobile.

### 4.6 Projects & Library
- A **Projects / workspace** view where users organize their generations and storyboards.
- Personal **asset library** — browse, preview, download, and re-run past outputs (images and video).

### 4.7 Subscriptions & Credits (Cross-Platform Billing)
- **Stripe integration** for web — subscription plans and one-off **credit top-up** purchases.
- Web purchases **feed the existing credit ledger** (the single source of truth), so a user's balance is consistent across mobile and web.
- Paywall / plan-selection UI, checkout, and post-purchase credit granting via Stripe webhooks.
- **Deep cross-platform billing reconciliation** — a **single unified entitlement and credit balance per user** across web (Stripe) and mobile (RevenueCat), regardless of where they subscribed or topped up, with conflict handling for users active on both platforms.
- Credit balance and usage display in the web app.

### 4.8 Delivery & Quality
- Deployment of the web app to the client's hosting (Vercel or equivalent).
- Basic automated checks (CI) and targeted tests around the new billing/credit paths.
- Handover documentation and a walkthrough session.

---

## 5. Technical Approach

- **Front-end:** Next.js App Router + React, reusing Clickefy's established component library, theming, and API-client conventions.
- **Backend:** **No re-architecture.** The web app talks to the *existing* Cloudflare Worker API and generation pipeline. New endpoints are added only where the web surface needs them (e.g., Stripe checkout/webhook, projects).
- **Billing:** Stripe for web, running **alongside** the existing RevenueCat mobile billing. Both write entitlements and credits into the shared ledger, and this engagement includes **reconciling the two into a single cross-platform balance per user**, keeping the database the single source of truth.
- **Models:** the web app exposes the client's existing Gemini / Kling / Seedance adapters, **plus two new image adapters delivered in this engagement — Seedream and GPT-Image.** Adding further models (Veo, Sora, Wan, Flux, etc.) is available as an add-on (see Phase 2).

---

## 6. Timeline (4 Weeks)

| Week | Focus | Key deliverables |
| --- | --- | --- |
| **Week 1** | Foundation | Web app scaffold, design system port, Clerk web auth, core layout & navigation |
| **Week 2** | Generation & models | Create-Image + Create-Video flows, model picker, **Seedream + GPT-Image adapters**, live progress, Projects & Library |
| **Week 3** | Storyboard & monetization | **Storyboard workspace**, Stripe subscriptions + credit top-ups, ledger integration, paywall & checkout |
| **Week 4** | Reconciliation, templates & launch | **Cross-platform billing reconciliation**, template gallery, polish, billing/credit tests + CI, deployment, handover |

*Timeline assumes a prompt kickoff and the client dependencies in Section 8 being available at the start.*

---

## 7. Phase 2 Roadmap (Future — not included in this engagement)

These are the "professional power" features that would move the web app toward full Higgsfield parity. They are **scoped and quoted separately** once the MVP is live:

- **Cinema-Studio camera controls** — curated library of named camera moves (dolly, orbit, crane, crash-zoom) and motion presets.
- **Character consistency (Soul-ID style)** — reference-based first; optional model-training infrastructure later.
- **In-editor tools** — brush inpainting, upscaling, video-to-video.
- **Additional models** — Veo, Sora, Wan, Flux, and others (optionally via a model-aggregator such as fal.ai to add many at once).
- **Tiered concurrency & "unlimited" queue mechanics.**
- **Storyboard enhancements** — advanced timeline editing, transitions, and character-locked continuity (building on the Phase 1 Storyboard).

---

## 8. Assumptions & Client Dependencies

To hold the four-week timeline, the following are provided by Clickefy at kickoff:

- Active **Stripe account** with permission for MoonWhale to integrate.
- **Provider API keys / quota** (Gemini, Kling, Seedance) with headroom for web traffic.
- Access to the existing **codebase, backend, and hosting** (Cloudflare, Neon, Clerk, Vercel).
- **Brand assets** (logo, colors, fonts) and any specific design direction.
- A single **point of contact** empowered to give timely feedback and approvals.
- Existing **published templates** to surface in the web gallery.

Scope covers the deliverables in Section 4. New feature requests beyond that scope are handled as a change request or folded into Phase 2.

---

## 9. Investment & Payment Terms

| Item | Detail |
| --- | --- |
| **Total** | **$6,800 USD** — fixed price |
| Structure | 50% at kickoff ($3,400), 50% on delivery ($3,400) |
| Includes | Everything in Section 4, deployment, handover docs, and a walkthrough |
| Excludes | Third-party costs (Stripe fees, model/API usage, hosting), and all Phase 2 features |

A short **post-launch support window** for defect fixes is included; ongoing feature work and Phase 2 are quoted separately.


---

## 10. Next Steps

1. Client review and approval of this proposal.
2. Countersignature and kickoff scheduling.
3. Client provides the dependencies in Section 8.
4. Week 1 begins.

---

**MoonWhale**
_Contact: [hello@moonswhale.com] · [+964 780 280 6666] · [www.moonswhale.com]_

**Acceptance**

Signed on behalf of Clickefy.Ai — Cast U FZE LLC:

Name: ______________________  Title: ______________________

Signature: ______________________  Date: ______________________