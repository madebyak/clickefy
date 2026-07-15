# Clickefy Web — Bilingual (English / Arabic) + RTL Plan

Grounded in: the bundled **Next.js 16.2.2** docs (verified), a full **codebase audit**, and prior
Arabic/RTL research. Front-end only; no backend/API i18n here.

## 0. Stack (decided)

- **next-intl** — the standard i18n library for the App Router (Server Components first).
- **`[locale]` segment routing** — `app/[locale]/…` (Next 16 has **no** built-in App-Router i18n config; it's a DIY `[locale]` + proxy pattern that next-intl wires up).
- **IBM Plex Sans Arabic** — already loaded; Latin = Geist.
- **Tailwind logical properties** — already ~90% adopted across the app.

## 1. Next 16 specifics that shape everything (verified in local docs)

- **`proxy.ts`, not `middleware.ts`** — Next 16 renamed it. Node runtime only (no edge). next-intl's middleware goes here, exported as default/`proxy`.
- **`params` is async** — `const { locale } = await params` in every layout/page/`generateMetadata`; `use(params)` in client components.
- **Route group under locale** — `app/[locale]/(studio)/create` → `/{locale}/create`. Groups are URL-transparent, so our `(studio)` nests cleanly under `[locale]`.
- **Static locales** — `generateStaticParams()` on `app/[locale]/layout.tsx` returns `[{locale:'en'},{locale:'ar'}]`.
- **hreflang** — Metadata API `alternates.languages` + `metadataBase`.

## 2. Target structure

```
apps/web/
├── messages/{en,ar}.json          # translation catalogs
├── src/i18n/
│   ├── routing.ts                 # locales, defaultLocale, localePrefix
│   ├── request.ts                 # getRequestConfig → load messages
│   └── navigation.ts              # createNavigation → Link/useRouter/usePathname
├── proxy.ts                       # createMiddleware(routing)  (NOT middleware.ts)
├── next.config.ts                 # + createNextIntlPlugin(...)
└── app/
    ├── layout.tsx                 # passthrough (no <html> here)
    └── [locale]/
        ├── layout.tsx             # <html lang dir>, fonts, NextIntlClientProvider,
        │                          #   generateStaticParams, generateMetadata(hreflang)
        ├── page.tsx               # home
        ├── design-system/…        # EXCLUDED from i18n (dev tool)
        └── (studio)/
            ├── layout.tsx         # StudioProvider + topbar + sidebar
            ├── create/…  create-video/…  projects/…
```

## 3. Config (shape)

- `routing.ts`: `defineRouting({ locales:['en','ar'], defaultLocale:'en', localePrefix: <decision> })`
- `request.ts`: `getRequestConfig(async ({requestLocale}) => ({ locale, messages: (await import(\`../../messages/${locale}.json\`)).default }))`
- `navigation.ts`: `export const {Link, useRouter, usePathname, redirect, getPathname} = createNavigation(routing)` — **use these everywhere instead of `next/link` + `next/navigation`** so links stay locale-aware.
- `proxy.ts`: `export default createMiddleware(routing)` + `export const config = { matcher: '/((?!api|_next|_vercel|.*\\..*).*)' }`
- `next.config.ts`: `createNextIntlPlugin('./src/i18n/request.ts')(nextConfig)`

## 4. `[locale]/layout.tsx` (the hinge)

```tsx
export function generateStaticParams() { return routing.locales.map((locale) => ({ locale })); }

export async function generateMetadata({ params }): Promise<Metadata> {
  const { locale } = await params;
  return { metadataBase: new URL("https://clickefy-webb.vercel.app"),
    alternates: { languages: { en: "/", ar: "/ar" } }, /* + title/desc via getTranslations */ };
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  if (!routing.locales.includes(locale)) notFound();
  setRequestLocale(locale);
  const dir = locale === "ar" ? "rtl" : "ltr";
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning className={`dark ${fontVars}`}>
      <body><NextIntlClientProvider>{children}</NextIntlClientProvider><Toaster/></body>
    </html>
  );
}
```

`dir` on `<html>` is the single source of truth; the existing `[dir="rtl"]` CSS + logical utilities do the rest.

## 5. Message catalogs (from the audit — ~90 shippable strings)

Namespaces: `meta · nav · footer · home · models · templates · pricing · promptbar · account · studio · projects`.
(`design-system` ≈ 90 more strings — **excluded**, it's a dev tool.)

- **Interpolation:** `{kind}`, `{plan}`, `{name}`, `{count}`.
- **ICU plurals** (must, not hand-rolled): `assets`, `selected`, `runs`, credits — e.g.
  `"assets": "{count, plural, =0 {No assets} one {# asset} other {# assets}}"` (+ Arabic's `zero/one/two/few/many/other`).
- Server components: `getTranslations('ns')`; client: `useTranslations('ns')`.

## 6. RTL fix-list (small — audit found the app already clean)

1. **`studio-sidebar.tsx`** (the one real bug): drawer is pinned `left-0` and slides via `-translate-x-full` → in RTL it must anchor `start-0` and slide from the opposite side (add `rtl:translate-x-full`).
2. `studio-topbar.tsx`: `left-1/2` → `start-1/2` (centering, cosmetic).
3. `design-system/page.tsx`: `text-left`×2 → `text-start`, `mr-auto` → `me-auto` (dev page, low priority).
4. **Mirror 7 directional icons** with `rtl:-scale-x-100`: `ArrowRight`/`ArrowUpRight`/`SignOut` in home-hero (×2), video-banner, templates-section, credit-menu, selection-bar, profile-menu.
5. Replace 3 literal `→` glyphs (model-row, workspace) with a mirrored icon.
6. **Bug:** `workspace.tsx` `time.toLowerCase()` — invalid for Arabic; drop it (use formatted relative time).
- Already RTL-correct: every UI primitive, masonry, prompt-bar, navbar, pricing, footer, and the switch thumb (`ltr:/rtl:` translate).

## 7. Formatting

- **Numerals: Latin (Western) digits even in Arabic** (recommended for a product UI — prices, credits, counts, timers). Via `useFormatter`/`Intl` with `numberingSystem: 'latn'` where needed.
- Numbers/credits (`1,500`), currency (`$19`), dates → `useFormatter().number/dateTime`.
- Relative time (`Just now`/`Yesterday`) → `format.relativeTime`.
- Dynamic year in footer → compute, don't hardcode.
- Arabic type: line-height ~1.75, `letter-spacing: 0` (already set for `[dir=rtl]`).

## 8. SEO

- `metadataBase` + `alternates.languages` (en/ar) in `generateMetadata` → hreflang tags.
- Per-locale `<title>`/description via `getTranslations('meta')`.
- Optional: locale-aware `sitemap.ts`.

## 9. Deployment (Vercel)

- `proxy.ts` runs on Vercel (Node runtime) — no config change.
- `localePrefix` decision drives URLs (see below). With **as-needed**, existing English URLs (`/`, `/create`) are unchanged and Arabic lives at `/ar/*` — least disruptive to the live deploy.
- `generateStaticParams` pre-renders both locales.

## 10. Migration sequence (phased, verifiable)

0. **Commit current studio work** → clean base.
1. Install next-intl; add `routing/request/navigation`, `proxy.ts`, next.config plugin.
2. **Restructure routes** into `app/[locale]/…`; add `[locale]/layout.tsx` (html/dir/provider/metadata); swap `next/link`+`next/navigation` → next-intl navigation everywhere.
3. **Extract strings** → `messages/en.json`; wire `useTranslations`/`getTranslations` namespace-by-namespace (verify each renders).
4. **RTL fixes** (§6) + toLowerCase bug.
5. **Formatting** (§7) — plurals, numbers, relative time.
6. **Arabic** `ar.json` — draft, then native review.
7. **Locale switcher** in the top bar + navbar; end-to-end RTL verify; SEO; deploy.

## Open decisions (confirm before Phase 1)

1. **URL strategy** — `as-needed` (English at `/`, Arabic at `/ar`) vs `always` (`/en`, `/ar`).
2. **Numerals** — Latin digits in Arabic vs Arabic-Indic (٠١٢٣).
3. **Scope** — translate UI chrome now; leave demo data (template titles, seed project/model names) as-is for now?
4. **Arabic source** — I machine-draft `ar.json` now (fast, needs native review) vs you supply translations.
