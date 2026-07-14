# public/ — static assets

Files here are served from the site root (`/`). Drop real brand assets into the
folders below (replacing the `.gitkeep` placeholders).

```
public/
├── brand/     # Clickefy logo, wordmark, symbol (svg preferred; light + dark variants)
├── models/    # AI model / provider logos (gemini, kling, seedance, seedream, gpt-image …)
├── icons/     # favicon.ico, icon.png, apple-icon.png, etc.
└── og/        # Open Graph / social share images (1200×630)
```

## Notes
- App icons/favicons can also use Next's metadata file convention
  (`app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`) — prefer that for icons.
- Prefer **SVG** for logos; keep raster OG images optimized.
- Provider logos: the mobile app already has branded provider SVGs under
  `apps/mobile/components/create/` — ask if you want those extracted to web `.svg`s.

## What's needed (checklist)
- [ ] Clickefy logo (light + dark) in `brand/`
- [ ] Favicon set in `icons/` (or `app/` metadata files)
- [ ] Provider/model logos in `models/`
- [ ] Default OG share image in `og/`
