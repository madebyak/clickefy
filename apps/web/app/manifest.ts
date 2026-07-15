import type { MetadataRoute } from "next";

/**
 * Web app manifest (served at /manifest.webmanifest, auto-linked by Next).
 * Enables installability + correct icons/theming on Chrome & Android.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clickefy — AI Creator Studio",
    short_name: "Clickefy",
    description:
      "Professional AI image and video generation. Create with Nano Banana, Kling, Seedance and more.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
