/**
 * Generate the full favicon / app-icon set from a single source SVG.
 * Source:  public/icons/favicon.svg
 * Run:     pnpm --filter @clickfy/web gen:favicons
 *
 * Outputs (Next.js App Router metadata conventions + PWA manifest):
 *   app/icon.svg              — modern browsers (Chrome/Firefox/Safari/Edge), scalable
 *   app/favicon.ico           — legacy fallback (16/32/48 multi-res)
 *   app/apple-icon.png        — 180×180, iOS Safari (opaque black bg)
 *   public/icons/icon-192.png — PWA / Android (manifest)
 *   public/icons/icon-512.png — PWA / Android (manifest)
 *   public/icons/maskable-512.png — Android adaptive (safe-zone padded, black bg)
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "public/icons/favicon.svg");
const svg = readFileSync(SRC);
const BG = "#000000";

// Rasterize the SVG at a given size (transparent background).
const png = (size) =>
  sharp(svg, { density: 512 }).resize(size, size, { fit: "contain" }).png().toBuffer();

// Rasterize onto an opaque background (for platforms that don't allow alpha).
const pngOnBg = (size, inner = size) =>
  sharp(svg, { density: 512 })
    .resize(inner, inner, { fit: "contain" })
    .toBuffer()
    .then((icon) =>
      sharp({ create: { width: size, height: size, channels: 4, background: BG } })
        .composite([{ input: icon, gravity: "center" }])
        .png()
        .toBuffer(),
    );

async function main() {
  // 1) Modern SVG icon — just copy the source.
  copyFileSync(SRC, resolve(root, "app/icon.svg"));

  // 2) favicon.ico (16/32/48).
  const ico = await pngToIco([await png(16), await png(32), await png(48)]);
  writeFileSync(resolve(root, "app/favicon.ico"), ico);

  // 3) Apple touch icon — opaque, iOS rounds the corners itself.
  writeFileSync(resolve(root, "app/apple-icon.png"), await pngOnBg(180));

  // 4) PWA icons (transparent).
  writeFileSync(resolve(root, "public/icons/icon-192.png"), await png(192));
  writeFileSync(resolve(root, "public/icons/icon-512.png"), await png(512));

  // 5) Maskable (Android adaptive) — icon at ~80% inside a black safe zone.
  writeFileSync(resolve(root, "public/icons/maskable-512.png"), await pngOnBg(512, 410));

  console.log("✓ Favicons generated from", SRC);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
