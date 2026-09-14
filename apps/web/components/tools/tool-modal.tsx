"use client";

/**
 * Shared shell for the studio tool modals — backdrop, panel, header
 * with the tool's identity and a close button, Escape-to-close. The
 * anatomy mirrors the existing dialogs (AssetInfoPanel's header, the
 * surface/border/radius scale) so the tools read as part of the app.
 */

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "@phosphor-icons/react";
import { Modal } from "@/components/ui/modal";
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

  return (
    <Modal label={title} onClose={onClose} className={cn("overflow-hidden", panelClassName)}>
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            {icon}
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </Modal>
  );
}
