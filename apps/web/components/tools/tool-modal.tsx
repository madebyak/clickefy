"use client";

/**
 * Shared shell for the studio tool modals — backdrop, panel, header
 * with the tool's identity and a close button, Escape-to-close. The
 * anatomy mirrors the existing dialogs (AssetInfoPanel's header, the
 * surface/border/radius scale) so the tools read as part of the app.
 */

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function ToolModal({
  title,
  icon,
  onClose,
  children,
  panelClassName,
}: {
  title: string;
  /** 28px identity chip content (an icon on its tinted square). */
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
}) {
  const t = useTranslations("studio");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl shadow-black/50",
          panelClassName,
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            {icon}
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
