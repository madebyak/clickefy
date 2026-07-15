"use client";

import { useLocale, useTranslations } from "next-intl";
import { Translate, Check } from "@phosphor-icons/react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Menu, MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";

const LOCALES: { code: Locale; label: string; short: string }[] = [
  { code: "en", label: "English", short: "EN" },
  { code: "ar", label: "العربية", short: "ع" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("language");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  return (
    <Menu
      align="end"
      panelClassName="w-40"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("change")}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            open && "bg-surface-2 text-foreground",
            className,
          )}
        >
          <Translate className="size-4" />
          <span className="font-medium">{current.short}</span>
        </button>
      )}
    >
      {({ close }) => (
        <>
          {LOCALES.map((l) => (
            <MenuItem
              key={l.code}
              onClick={() => {
                // Preserve the current path; next-intl handles the locale prefix.
                router.replace(pathname, { locale: l.code });
                close();
              }}
            >
              <span className={l.code === "ar" ? "font-[family-name:var(--font-ibm-arabic)]" : undefined}>
                {l.label}
              </span>
              {l.code === locale && <Check weight="bold" className="ms-auto size-4 text-foreground" />}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
