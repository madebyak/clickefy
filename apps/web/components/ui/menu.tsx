"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Lightweight dropdown: click-outside + Escape to close, RTL-aware (start/end). */
export function Menu({
  trigger,
  children,
  align = "end",
  side = "bottom",
  panelClassName,
}: {
  trigger: (s: { open: boolean; toggle: () => void }) => ReactNode;
  children: (h: { close: () => void }) => ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cn(
            "absolute z-50 min-w-48 rounded-xl border border-border bg-surface-3 p-1.5 shadow-2xl shadow-black/50",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "end" ? "end-0" : "start-0",
            panelClassName,
          )}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

export function MenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}>{children}</p>;
}

export function MenuItem({
  children,
  onClick,
  className,
  destructive = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  /** Red text for delete/remove actions. */
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start text-sm outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5",
        destructive ? "text-status-red" : "text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
