# public/ — static assets

Files here are served from the site root (`/`). Drop real brand assets at the
**exact paths below** — the `/design-system` page renders them automatically
(and shows a "Drop file at …" placeholder until they exist).

```
public/
├── brand/
│   ├── logo.svg          # full wordmark + symbol
│   ├── logo-mark.svg     # square symbol / app mark
│   └── logo-white.svg    # monochrome white (for dark surfaces)
├── models/               # AI model / provider logos (gemini, kling, seedance, seedream, gpt-image …)
├── icons/
│   ├── icon-192.png      # 192×192 (PWA)
│   ├── icon-512.png      # 512×512 (PWA)
│   └── apple-icon.png    # 180×180 (iOS)
└── og/                   # Open Graph / social share image (1200×630)
```

Favicon: `app/favicon.ico` (Next metadata convention) — a placeholder is in place;
replace with the real brand favicon. You can also add `app/icon.png` and
`app/apple-icon.png` and Next will wire them automatically.

## Notes
- Prefer **SVG** for logos; keep raster OG/PWA icons optimized.
- Provider/model logos: the mobile app already has branded provider SVGs under
  `apps/mobile/components/create/` — ask if you want those extracted to web `.svg`s.

## Homepage media (bento hero)

Auto-loop videos (muted, `.mp4`) — drop into `public/media/`. Until they exist,
each card shows a tinted gradient placeholder.

```
public/media/
├── hero-image.mp4       # left "Image Studio" hero
├── create-video.mp4     # "Create video" card
└── product-visuals.mp4  # "Product visuals" card
```

Model logos — `public/models/<id>.svg` (falls back to a monogram tile):
`gpt-image.svg`, `nano-banana-pro.svg`, `nano-banana-2.svg`, `seedream.svg`, `imagen.svg`.

## Checklist
- [ ] `brand/logo.svg`, `brand/logo-mark.svg`, `brand/logo-white.svg`
- [ ] `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-icon.png`
- [ ] real `app/favicon.ico`
- [ ] provider/model logos in `models/`
- [ ] `og/` share image
