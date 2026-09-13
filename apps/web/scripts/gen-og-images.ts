/**
 * Generate every social share card.
 * Run:  pnpm --filter @clickfy/web gen:og
 *
 * Outputs (committed files, referenced from page metadata):
 *   public/og/default.png               — the site-wide card: wordmark on black
 *   public/og/blog/<slug>-<locale>.png  — one per post and locale: topic, date, title
 *
 * Plain public files rather than the `opengraph-image` file convention — see
 * SHARE_IMAGE in lib/page-metadata.ts for why.
 *
 * Text is set in the site's own faces (Geist; IBM Plex Sans Arabic for
 * Arabic), vendored in scripts/fonts/, and colours are read from the design
 * tokens in app/globals.css — so a card always looks like the page it links
 * to. Re-run after editing a post title or a brand colour.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BLOG_POSTS, type BlogPost } from "../lib/blog/posts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;

/* ------------------------------------------------------------- tokens */

const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
function token(name: string, fallback: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  return match ? match[1]! : fallback;
}
const C = {
  bg: token("background", "#000000"),
  panel: token("surface-1", "#0a0a0c"),
  border: token("border", "#26262d"),
  text: token("foreground", "#fafafa"),
  muted: token("muted-foreground", "#a1a1aa"),
  green: token("brand-green", "#42d676"),
};

/** The blog's accent washes — the same colours and corners as ACCENT_WASH in app/[locale]/blog/page.tsx. */
const ACCENT: Record<BlogPost["accent"], { rgb: string; alpha: number; cx: string; cy: string }> = {
  green: { rgb: "66,214,118", alpha: 0.28, cx: "0%", cy: "0%" },
  purple: { rgb: "99,3,224", alpha: 0.35, cx: "100%", cy: "0%" },
  turquoise: { rgb: "0,220,174", alpha: 0.22, cx: "0%", cy: "100%" },
  gold: { rgb: "245,197,66", alpha: 0.22, cx: "100%", cy: "100%" },
};

const FONT = {
  latin: resolve(root, "scripts/fonts/Geist-Latin.woff2"),
  arabicBold: resolve(root, "scripts/fonts/IBMPlexSansArabic-Bold-Arabic.woff2"),
  arabicMedium: resolve(root, "scripts/fonts/IBMPlexSansArabic-Medium-Arabic.woff2"),
};

const LOGO = resolve(root, "public/brand/logo-white.svg");
const MESSAGES = {
  en: JSON.parse(readFileSync(resolve(root, "messages/en.json"), "utf8")),
  ar: JSON.parse(readFileSync(resolve(root, "messages/ar.json"), "utf8")),
} as const;

/* ------------------------------------------------------------- helpers */

const escapeMarkup = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Pango picks a paragraph's direction from its first strong character, so an
 * Arabic title that opens with a Latin model name ("Kling أم Seedance؟…") was
 * laid out left-to-right: words out of order, the question mark at the wrong
 * end. A leading RIGHT-TO-LEFT MARK — invisible — makes the paragraph RTL.
 */
const RLM = String.fromCharCode(0x200f);

/** Render Pango markup to a transparent PNG, word-wrapped at `width`. */
async function renderText(markup: string, font: string, fontfile: string, width: number, align: "left" | "right") {
  const { data, info } = await sharp({
    text: { text: markup, font, fontfile, width, align, rgba: true, dpi: 72, wrap: "word" },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/* ------------------------------------------------------------- default card */

async function defaultCard(): Promise<Buffer> {
  // A faint green glow behind the wordmark, so the card reads as the brand
  // rather than a black rectangle with a logo on it.
  const backdrop = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="55%">
          <stop offset="0" stop-color="${C.green}" stop-opacity="0.16"/>
          <stop offset="1" stop-color="${C.green}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="${C.bg}"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
    </svg>`,
  );
  // ~53% of the width: legible in a small chat preview, clear of the crop
  // some networks apply to a card's edges.
  const logo = await sharp(readFileSync(LOGO), { density: 600 }).resize({ width: 640 }).png().toBuffer();
  return sharp(backdrop).composite([{ input: logo, gravity: "center" }]).png({ compressionLevel: 9 }).toBuffer();
}

/* ------------------------------------------------------------- blog cards */

/** The blog article header, redrawn at card size: surface panel, accent wash, hairline border. */
const PANEL = { x: 40, y: 40, w: W - 80, h: H - 80, r: 36 };
const INSET = 104; // panel edge + 64px of inner padding
const CONTENT_W = W - INSET * 2;
const MAX_TITLE_H = 250; // three lines at the largest size

function blogBackdrop(accent: BlogPost["accent"]): Buffer {
  const a = ACCENT[accent];
  const { x, y, w, h, r } = PANEL;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <clipPath id="panel"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>
        <radialGradient id="wash" cx="${a.cx}" cy="${a.cy}" r="80%">
          <stop offset="0" stop-color="rgb(${a.rgb})" stop-opacity="${a.alpha}"/>
          <stop offset="0.6" stop-color="rgb(${a.rgb})" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="${C.bg}"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${C.panel}"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#wash)" clip-path="url(#panel)"/>
      <rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r}" fill="none" stroke="${C.border}"/>
    </svg>`,
  );
}

async function blogCard(post: BlogPost, locale: "en" | "ar"): Promise<Buffer> {
  const rtl = locale === "ar";
  const align = rtl ? "right" : "left";
  const content = post.content[locale];
  const m = MESSAGES[locale].blog;

  // Largest title size that still fits three lines; the last size is kept
  // regardless, so an unusually long title still renders.
  let title!: Awaited<ReturnType<typeof renderText>>;
  // Arabic paragraphs open with the mark so they lay out right-to-left.
  const lead = rtl ? RLM : "";
  for (const size of [68, 60, 52, 46]) {
    title = await renderText(
      `<span foreground="${C.text}">${lead}${escapeMarkup(content.title)}</span>`,
      rtl ? `IBM Plex Sans Arabic Bold ${size}` : `Geist Bold ${size}`,
      rtl ? FONT.arabicBold : FONT.latin,
      CONTENT_W,
      align,
    );
    if (title.height <= MAX_TITLE_H) break;
  }

  const date = new Intl.DateTimeFormat(rtl ? "ar-EG" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${post.date}T00:00:00Z`));
  const readTime = String(m.readTime).replace("{minutes}", new Intl.NumberFormat(locale).format(post.readMinutes));
  const meta = await renderText(
    `<span foreground="${C.green}">${lead}${escapeMarkup(m[`tag_${post.tag}`])}</span>` +
      `<span foreground="${C.muted}">   ·   ${escapeMarkup(date)}   ·   ${escapeMarkup(readTime)}</span>`,
    rtl ? "IBM Plex Sans Arabic Medium 26" : "Geist Medium 26",
    rtl ? FONT.arabicMedium : FONT.latin,
    CONTENT_W,
    align,
  );

  const url = await renderText(
    `<span foreground="${C.muted}">clickefy.ai/blog</span>`,
    "Geist Medium 24",
    FONT.latin,
    CONTENT_W,
    "left",
  );

  const logo = await sharp(readFileSync(LOGO), { density: 600 }).resize({ height: 40 }).png().toBuffer({ resolveWithObject: true });

  // Bottom-anchored stack: URL on the panel's bottom inset, title above it,
  // topic and date above the title. The logo holds the top.
  const contentBottom = PANEL.y + PANEL.h - 64;
  const urlTop = contentBottom - url.height;
  const titleTop = urlTop - 44 - title.height;
  const metaTop = titleTop - 22 - meta.height;
  const start = (width: number) => (rtl ? W - INSET - width : INSET);

  return sharp(blogBackdrop(post.accent))
    .composite([
      { input: logo.data, left: start(logo.info.width), top: INSET },
      { input: meta.data, left: start(meta.width), top: metaTop },
      { input: title.data, left: start(title.width), top: titleTop },
      { input: url.data, left: rtl ? W - INSET - url.width : INSET, top: urlTop },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/* ------------------------------------------------------------- main */

async function main() {
  const ogDir = resolve(root, "public/og");
  const blogDir = resolve(ogDir, "blog");
  mkdirSync(blogDir, { recursive: true });

  const def = await defaultCard();
  writeFileSync(resolve(ogDir, "default.png"), def);
  console.log(`✓ og/default.png (${(def.length / 1024).toFixed(1)} KB)`);

  for (const post of BLOG_POSTS) {
    for (const locale of Object.keys(post.content) as Array<"en" | "ar">) {
      const png = await blogCard(post, locale);
      writeFileSync(resolve(blogDir, `${post.slug}-${locale}.png`), png);
      console.log(`✓ og/blog/${post.slug}-${locale}.png (${(png.length / 1024).toFixed(1)} KB)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
