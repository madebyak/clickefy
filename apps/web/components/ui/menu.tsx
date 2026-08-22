"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Gap between the trigger and the panel, and the minimum viewport inset. */
const GAP = 8;

/** Lightweight dropdown: click-outside + Escape to close, RTL-aware (start/end). */
export function Menu({
  trigger,
  children,
  align = "end",
  side = "bottom",
  panelClassName,
  portal = false,
}: {
  trigger: (s: { open: boolean; toggle: () => void }) => ReactNode;
  children: (h: { close: () => void }) => ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
  panelClassName?: string;
  /**
   * Render the panel into <body> at fixed coordinates instead of
   * absolutely inside the trigger's box.
   *
   * Needed wherever an ancestor clips: a masonry tile is
   * `overflow-hidden` and, at high grid density, shorter than the menu
   * it would open — an in-flow panel is simply invisible there.
   */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The portalled panel is outside `ref`, so it needs its own test
      // or every click inside the menu would dismiss it.
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Fixed-position placement for the portalled panel: anchor to the
  // trigger, flip when it would run off the bottom, clamp to the
  // viewport. Runs in a layout effect so the panel never paints at the
  // wrong coordinates first.
  useLayoutEffect(() => {
    if (!open || !portal) return;

    const place = () => {
      const t = ref.current?.getBoundingClientRect();
      const p = panelRef.current?.getBoundingClientRect();
      if (!t || !p) return;

      let top = side === "top" ? t.top - p.height - GAP : t.bottom + GAP;
      const overflowsBelow = top + p.height > window.innerHeight - GAP;
      const fitsAbove = t.top - p.height - GAP >= GAP;
      if (side !== "top" && overflowsBelow && fitsAbove) top = t.top - p.height - GAP;
      top = Math.max(GAP, Math.min(top, window.innerHeight - p.height - GAP));

      // `end` means the right edge in LTR and the left edge in RTL, which
      // is free with logical CSS but has to be resolved by hand here.
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      const anchorRight = (align === "end") !== rtl;
      let left = anchorRight ? t.right - p.width : t.left;
      left = Math.max(GAP, Math.min(left, window.innerWidth - p.width - GAP));

      setPos({ top, left });
    };

    place();
    // Capture phase so scrolling an inner container (the studio canvas)
    // repositions the panel too, not just a window scroll.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, portal, side, align]);

  const panel = (
    <div
      ref={panelRef}
      className={cn(
        "z-50 min-w-48 rounded-xl border border-border bg-surface-3 p-1.5 shadow-2xl shadow-black/50",
        portal
          ? "fixed"
          : cn(
              "absolute",
              side === "top" ? "bottom-full mb-2" : "top-full mt-2",
              align === "end" ? "end-0" : "start-0",
            ),
        // Hidden for the first frame while the layout effect measures it.
        portal && !pos && "pointer-events-none opacity-0",
        panelClassName,
      )}
      style={portal ? { top: pos?.top ?? 0, left: pos?.left ?? 0 } : undefined}
    >
      {children({ close: () => setOpen(false) })}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (portal ? createPortal(panel, document.body) : panel)}
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
