import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Locale-aware 404. Rendered when a route segment inside [locale] calls
 * notFound() (e.g. an unknown template id). The root not-found.tsx
 * handles paths outside the [locale] tree.
 */
export default function LocaleNotFound() {
  const t = useTranslations("errors");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <p className="text-6xl font-semibold tracking-tight text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("notFoundBody")}</p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("goHome")}
      </Link>
    </main>
  );
}
