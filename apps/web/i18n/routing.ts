import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ar"],
  defaultLocale: "en",
  // English stays unprefixed (/, /create); Arabic is prefixed (/ar, /ar/create).
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
