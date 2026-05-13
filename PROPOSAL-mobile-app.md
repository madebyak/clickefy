# Clickfy — Mobile Application Development Proposal

**Prepared by:** MoonWhale  
**Prepared for:** Clickfy  
**Date:** May 7, 2025  
**Version:** 1.0 (Draft)

---

## 1. Executive Summary

Clickfy has a working backend system — an admin dashboard where templates are created, categories are managed, and AI generation pipelines are configured and tested using Google Gemini and Kling AI. The next step is to bring this to end users.

We propose designing and developing a **cross-platform mobile application** (iOS & Android) using **React Native** that allows small business owners and content creators to generate professional product photos and videos in one tap — no design skills required.

The project will be executed in **two phases**: UX/UI Design first, then Front-End Development, delivered within **30 days**.

---

## 2. Market Context

AI-powered product photography is a fast-growing space. Existing players include:

| Competitor | Model | Strengths | Gap Clickfy Fills |
|---|---|---|---|
| **Photoroom** | Subscription (Pro/Max/Ultra) | Polished mobile app, batch workflows, marketplace-first | Complex UI, not template-driven, no video generation |
| **Pebblely** | Credits (from free) | Simple background generation, beginner-friendly | Web-only, limited to backgrounds, no video |
| **Flair.ai** | Subscription | Drag-and-drop scene staging, brand kits | Desktop-focused, steep learning curve for non-designers |
| **Claid.ai** | Credits (from $9/mo) | Full editing suite, fashion AI, API workflows | Enterprise-oriented, overwhelming for small sellers |
| **Mintly** | Credits | Ad creatives, UGC-style video | Focused on ads, not general product content |

**Clickfy's differentiator:** A mobile-first, template-driven experience where the user uploads a product photo, picks a template, and gets studio-quality images and videos — all in one tap. No scene staging, no prompt writing, no editing. The complexity is hidden inside the admin-configured templates.

---

## 3. Scope of Work

### Phase 1 — UX/UI Design ($700)

- User research and flow mapping
- Wireframes for all core screens
- High-fidelity UI designs (Figma) for both iOS and Android
- Design system / component library setup
- Interactive prototype for stakeholder review

**Core screens to design:**
- Onboarding & Authentication (sign-up, login, social auth)
- Home / Explore (featured templates, categories, search)
- Category browsing with filters
- Template detail (preview gallery, description, input requirements)
- Generation flow (upload inputs → processing → result)
- Result screen (preview, download, share, regenerate)
- Subscription / Credit packages (purchase, balance, history)
- User profile & settings
- Generation history (past results)

### Phase 2 — Front-End Development ($3,900)

- React Native (Expo) project setup for iOS and Android
- Full implementation of all designed screens
- API integration with the existing Clickfy backend
- Credit-based subscription system (in-app purchases via RevenueCat or similar)
- Push notifications (job completion, low credits, promotions)
- Image/video upload with compression and validation
- Real-time generation status (progress tracking, polling)
- Offline-ready result gallery (cached generated content)
- App Store and Play Store submission-ready builds

---

## 4. Subscription & Credits Model

The app will use a **credit-based system** where each generation costs a defined number of credits based on template complexity (image-only vs. image + video).

| Package | Credits | Price | Best For |
|---|---|---|---|
| Starter | 20 credits | $4.99 | Trying the app, occasional use |
| Creator | 60 credits | $11.99 | Regular content creators |
| Business | 150 credits | $24.99 | Active sellers, weekly content |
| Pro | 400 credits | $49.99 | High-volume businesses |

- Credits do not expire
- Users can purchase additional credit packs at any time
- Example costs: Image generation = 1 credit, Image + Video = 3 credits
- Optional: Daily free credit (1/day) to keep users engaged

*Final pricing and credit values to be confirmed by Clickfy.*

---

## 5. Timeline

| Week | Phase | Deliverables |
|---|---|---|
| **Week 1** | UX/UI Design | Wireframes, user flows, design system |
| **Week 2** | UX/UI Design | High-fidelity screens, prototype, design review & revisions |
| **Week 3** | Front-End Dev | Project setup, auth, home, categories, template browsing |
| **Week 4** | Front-End Dev | Generation flow, results, credits/subscription, profile, polish & testing |

**Total duration: 30 days**

---

## 6. Investment Summary

| Phase | Cost |
|---|---|
| Phase 1 — UX/UI Design | $700 |
| Phase 2 — Front-End Development | $3,900 |
| **Total** | **$4,600** |

Payment terms to be agreed upon separately.

---

## 7. Next Steps

1. **Approve this proposal** to initiate Phase 1.
2. MoonWhale delivers wireframes and design prototype for review (end of Week 2).
3. Upon design approval, Phase 2 (development) begins immediately.
4. Final delivery and app store submission support by Day 30.

---

*MoonWhale — Building products that move.*
