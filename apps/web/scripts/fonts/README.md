# Share-card fonts

Used only by `scripts/gen-og-images.ts` to draw text onto the social share
cards, so a card is set in the same type as the page it links to. Never
served to browsers — the site itself loads these families through
`next/font`.

| File | Family | Notes |
| --- | --- | --- |
| `Geist-Latin.woff2` | Geist (variable, 100–900) | Latin subset |
| `IBMPlexSansArabic-Bold-Arabic.woff2` | IBM Plex Sans Arabic 700 | Arabic subset |
| `IBMPlexSansArabic-Medium-Arabic.woff2` | IBM Plex Sans Arabic 500 | Arabic subset |

Both families are distributed under the SIL Open Font License 1.1, which
permits bundling and redistribution. The files are the Google Fonts subsets
that `next/font` fetches at build time.
