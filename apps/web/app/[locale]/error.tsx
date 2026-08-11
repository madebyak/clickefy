"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Locale-aware error boundary for the [locale] segment. Catches render
 * errors in any child route and offers a reset + escape hatch home.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    // Surface to the console (and any wired reporter) for diagnosis.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("errorBody")}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("retry")}
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-lg bg-surface-3 px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
        >
          {t("goHome")}
        </Link>
      </div>
    </main>
  );
}
