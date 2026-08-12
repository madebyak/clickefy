import { notFound } from "next/navigation";

/**
 * Catch-all for unmatched paths under a valid locale (e.g. /ar/garbage).
 * Without it, such URLs fall outside the [locale] tree and get the
 * unlocalized root 404; calling notFound() here renders the localized
 * app/[locale]/not-found.tsx inside the proper document instead. This is
 * next-intl's documented error-files pattern.
 */
export default function CatchAllNotFound(): never {
  notFound();
}
