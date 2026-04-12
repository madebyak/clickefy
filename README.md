# Clickefy — Admin Dashboard & Generation API

AI-powered content generation platform. Admins create templates in this dashboard; mobile users (React Native) browse templates and generate images/videos.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS v4, shadcn/ui (Base UI) |
| State | Zustand (client), @tanstack/react-query (installed, not yet wired) |
| AI Providers | Google Gemini / Imagen (`@google/genai`), Kling AI (REST + JWT) |
| Icons | Lucide React |
| Toasts | Sonner |

## Quick Start

```bash
cp .env.example .env.local    # fill in your API keys
npm install
npm run dev                    # http://localhost:3000 → redirects to /admin
```

## Project Structure

```
app/
├── layout.tsx                 # Root layout (fonts, providers)
├── page.tsx                   # Redirects / → /admin
├── (admin)/
│   ├── layout.tsx             # Sidebar + main content shell
│   └── admin/
│       ├── page.tsx           # Dashboard (stats, quick actions)
│       ├── categories/        # Category CRUD
│       └── templates/
│           ├── page.tsx       # Template list with filters
│           └── [id]/page.tsx  # Template editor (4-tab form + playground)
└── api/
    └── generate/
        ├── route.ts           # POST — run a single AI generation stage
        └── status/route.ts    # GET  — poll async task status (Kling)

components/
├── categories/                # CategoryTree, CategoryForm
├── templates/                 # TemplateCard, TemplatesFilters
│   └── editor/                # BasicInfoTab, UserInputTab, GenerationTab, PlaygroundTab
├── layout/                    # AppSidebar
└── ui/                        # shadcn/ui primitives (do not edit directly)

lib/
├── types/                     # TypeScript interfaces (Template, Category, GenerationJob)
├── stores/                    # Zustand stores (templates, categories) — mock data
├── services/                  # AI provider clients (Gemini, Kling)
└── utils.ts                   # cn() helper

data/mock/                     # JSON seed data for Zustand stores
docs/                          # PRD, technical spec, build notes
```

## Architecture Overview

```
┌─────────────────────────────────┐
│  Admin Dashboard (this repo)    │
│  Next.js — manages templates,   │
│  categories, and tests AI       │
│  generation via Playground tab  │
└──────────┬──────────────────────┘
           │ Admin CRUD (Zustand → future API)
           ▼
┌─────────────────────────────────┐
│  MongoDB (to be integrated)     │
│  Collections: templates,        │
│  categories, jobs, users        │
└──────────┬──────────────────────┘
           │ Public API (to be built)
           ▼
┌─────────────────────────────────┐
│  React Native Mobile App        │
│  Browse templates → submit      │
│  inputs → receive generated     │
│  images/videos                  │
└─────────────────────────────────┘
```

---

## Integration Guide for Developers

### 1. MongoDB Integration

The codebase is currently backed by mock JSON data in `data/mock/`. Every Zustand store method (`lib/stores/`) includes a `setTimeout` to simulate network latency. Replace these with real API calls.

**Collections to create:**

| Collection | Source Type | Key Indexes |
|-----------|-----------|-------------|
| `templates` | `lib/types/template.ts` | `slug` (unique), `status + sortOrder`, `categoryId` |
| `categories` | `lib/types/category.ts` | `slug` (unique), `parentId` |
| `jobs` | `lib/types/generation.ts` | `userId + createdAt`, `status`, `templateId` |
| `users` | (new) | `email` (unique) |

**Steps:**

1. Add `mongoose` or `mongodb` driver to `package.json`.
2. Create a DB connection utility at `lib/db.ts` (use `MONGODB_URI` from env).
3. Create Mongoose models under `lib/models/` mirroring the types in `lib/types/`.
4. Build admin API routes under `app/api/admin/` for CRUD (templates, categories).
5. Update Zustand stores to call these API routes instead of reading mock JSON.
6. Store binary assets (cover images, reference images) in S3/GCS — save URLs in MongoDB.

**Where to look:** Each type file (`lib/types/*.ts`) and store file (`lib/stores/*.ts`) has `@integration MongoDB` comments with specific guidance.

### 2. React Native Mobile API

The mobile app needs a public-facing API. The existing `/api/generate` endpoint handles raw AI calls but should not be exposed directly to mobile users.

**API routes to build (suggested under `app/api/`):**

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/templates` | List published templates (with pagination) |
| `GET` | `/api/templates/:id` | Get single template (public fields only — exclude `generation` config) |
| `GET` | `/api/categories` | List all categories (flat or tree) |
| `POST` | `/api/jobs` | Submit a generation job (templateId + user inputs) |
| `GET` | `/api/jobs/:id` | Poll job status / get results |
| `POST` | `/api/auth/login` | User authentication |
| `POST` | `/api/auth/register` | User registration |

**Key considerations:**
- The `Template.generation` field contains admin-only config (prompts, API keys, reference images). Never expose it to mobile clients.
- `Template.userInputs` defines the dynamic form the mobile app renders — this IS sent to mobile.
- The jobs API should orchestrate the multi-stage pipeline server-side (iterate `generation.stages`, call `/api/generate` internally, store results in MongoDB).
- Use presigned S3/GCS URLs for file uploads from mobile instead of raw base64.

**Where to look:** Each type file has `@integration React Native` comments explaining which fields are mobile-facing.

### 3. Sidebar Nav Stubs

The sidebar (`components/layout/app-sidebar.tsx`) links to three routes that don't exist yet:

| Route | Purpose |
|-------|---------|
| `/admin/jobs` | View generation job history and status |
| `/admin/analytics` | Usage stats, cost tracking, success rates |
| `/admin/settings` | API key management, provider config |

Create `page.tsx` files under `app/(admin)/admin/` for each.

### 4. State Management Migration

`@tanstack/react-query` is already installed but not yet used. When connecting to real APIs, consider migrating from raw Zustand fetches to React Query for:
- Automatic cache invalidation and background refetching
- Optimistic updates
- Request deduplication
- Built-in loading/error states

The Zustand stores can still hold UI-only state (filters, selected items) while React Query handles server state.

## AI Provider Reference

### Gemini / Imagen (Google)

- Service: `lib/services/gemini.ts`
- Models: `gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`, `imagen-4.0-*`
- Supports: text-to-image, image-to-image, reference-guided generation
- Auth: `GEMINI_API_KEY` env var

### Kling AI

- Service: `lib/services/kling.ts`
- Models: `kling-v2-6`, `kling-v2-5-turbo`, `kling-v2-master`
- Supports: image-to-video only (async — requires polling)
- Auth: JWT signed with `KLING_ACCESS_KEY` + `KLING_SECRET_KEY`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google AI API key |
| `KLING_ACCESS_KEY` | Yes | Kling API access key |
| `KLING_SECRET_KEY` | Yes | Kling API secret key |
| `MONGODB_URI` | Pending | MongoDB connection string (add during DB integration) |

See `.env.example` for the template.

## Scripts

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
```
