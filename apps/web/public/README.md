# public/ — static assets

Files here are served from the site root (`/`). The `/design-system` page
(development only) renders the brand files so they can be checked at a glance.

```
public/
├── brand/
│   ├── logo-white.svg    # wordmark for dark surfaces — what the site uses
│   ├── logo-black.svg    # wordmark for light surfaces
│   └── logo-mark.svg     # the symbol alone, transparent, cropped to the glyph
├── icons/
│   ├── favicon.svg       # SOURCE for every favicon / app icon (see below)
│   ├── icon-192.png      # PWA (manifest) — generated
│   ├── icon-512.png      # PWA (manifest) — generated
│   └── maskable-512.png  # Android adaptive — generated
├── og/
│   ├── default.png       # site-wide share card, 1200×630 — generated
│   └── blog/             # one card per post and locale — generated
├── models/               # AI model / provider logos
└── assets/               # homepage media
```

In code, render the wordmark with `<BrandLogo />`
(`components/site/brand-logo.tsx`), not by path — the next brand change is then
one edit. The mark's green is the UI's `--brand-green`.

## Favicons and app icons

Generated from `icons/favicon.svg`:

```
pnpm --filter @clickfy/web gen:favicons
```

writes the Next.js metadata files `app/icon.svg`, `app/favicon.ico`,
`app/apple-icon.png`, plus the PWA icons above. Next links them automatically.

## Social share cards

```
pnpm --filter @clickfy/web gen:og
```

runs `scripts/gen-og-images.ts`, which writes `og/default.png` (the wordmark
card every page uses) and `og/blog/<slug>-<locale>.png` (topic, date and title
for each post). Text is set in the site's own fonts (`scripts/fonts/`) and
colours come from the tokens in `app/globals.css`.

Pages point at these files through `lib/page-metadata.ts` — deliberately not
the `opengraph-image` file convention, which Next's shallow metadata merge
dropped from every page that sets its own og:url.

## Notes
- Prefer **SVG** for logos; keep raster share and PWA images optimized.
- After changing a source SVG, a brand colour or a post title, re-run the
  generators — the PNG/ICO outputs are committed files and do not update
  themselves.
