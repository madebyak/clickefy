"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Gap between the trigger and the panel, and the minimum inset from any edge. */
const GAP = 8;

/**
 * Tallest a panel grows before it scrolls — about eight rows. A long list
 * (every model, every Seedance duration) becomes a list you scroll instead
 * of a column that runs off the screen; short menus never reach it.
 */
const MAX_PANEL_HEIGHT = 320;

/**
 * Below this much room on its preferred side, a panel opens the other way
 * when that side has more — so a trigger near an edge doesn't get a menu
 * two rows tall.
 */
const MIN_USABLE_HEIGHT = 160;

type Side = "top" | "bottom";
type Align = "start" | "end";

interface PanelLayout {
  side: Side;
  maxHeight: number;
  /** Fixed-viewport coordinates — portalled panels only. */
  top?: number;
  left?: number;
}

const sameLayout = (a: PanelLayout | null, b: PanelLayout) =>
  !!a && a.side === b.side && a.maxHeight === b.maxHeight && a.top === b.top && a.left === b.left;

/**
 * The vertical band a panel can actually be seen in: the viewport, narrowed
 * by every ancestor that clips it. An in-flow panel inside the homepage hero
 * card (overflow-hidden) or the scrolling sidebar is cut off at THAT box, so
 * capping against the window alone would still lose rows.
 */
function visibleBand(anchor: HTMLElement, portal: boolean) {
  let top = 0;
  let bottom = window.innerHeight;
  // A portalled panel lives in <body>; only the viewport can clip it.
  if (portal) return { top, bottom };
  for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.overflowY !== "visible") {
      const r = el.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
    }
    // Nothing above a fixed box can clip what is inside it.
    if (style.position === "fixed") break;
  }
  return { top, bottom };
}

/**
 * Places a mounted panel and caps its height to the room it really has, then
 * keeps doing so on resize, on any scroll outside the panel, and when its own
 * content changes size. A layout effect, so it never paints at the wrong size.
 */
function usePanelLayout(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  side: Side,
  align: Align,
  portal: boolean,
) {
  const [layout, setLayout] = useState<PanelLayout | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const t = anchor.getBoundingClientRect();
      const band = visibleBand(anchor, portal);
      const room: Record<Side, number> = {
        top: t.top - band.top - GAP * 2,
        bottom: band.bottom - t.bottom - GAP * 2,
      };
      const other: Side = side === "top" ? "bottom" : "top";
      const resolved = room[side] < MIN_USABLE_HEIGHT && room[other] > room[side] ? other : side;
      const maxHeight = Math.max(0, Math.min(MAX_PANEL_HEIGHT, Math.floor(room[resolved])));

      let next: PanelLayout = { side: resolved, maxHeight };
      if (portal) {
        // scrollHeight ignores max-height, so this is the natural height even
        // while an earlier cap is applied; the difference adds the borders.
        const natural = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
        const height = Math.min(natural, maxHeight);
        let top = resolved === "top" ? t.top - height - GAP : t.bottom + GAP;
        top = Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
        // `end` means the right edge in LTR and the left edge in RTL, which
        // is free with logical CSS but has to be resolved by hand here.
        const rtl = getComputedStyle(document.documentElement).direction === "rtl";
        const anchorRight = (align === "end") !== rtl;
        const width = panel.offsetWidth;
        let left = anchorRight ? t.right - width : t.left;
        left = Math.max(GAP, Math.min(left, window.innerWidth - width - GAP));
        next = { ...next, top, left };
      }
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };

    place();
    const onScroll = (e: Event) => {
      // Scrolling the list itself moves nothing — don't re-measure for it.
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      place();
    };
    // Capture phase, so scrolling an inner container (the studio canvas, the
    // sidebar) re-places the panel too, not just a window scroll.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    // A list that fills in while open (the model roster loading) changes the
    // natural height a portalled panel is placed by.
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [anchorRef, panelRef, side, align, portal]);

  return layout;
}

/**
 * On open, bring the current choice into view the way a native select does —
 * otherwise a long list opens at its top with the selected value (15s, at the
 * bottom of Seedance's durations) scrolled out of sight. Sets the panel's own
 * scrollTop rather than calling scrollIntoView, which would also scroll the
 * page behind the menu. Items opt in with `data-selected="true"`.
 */
function useRevealSelected(layout: PanelLayout | null, panelRef: RefObject<HTMLElement | null>) {
  const revealed = useRef(false);
  useLayoutEffect(() => {
    if (!layout || revealed.current) return;
    revealed.current = true;
    const panel = panelRef.current;
    const selected = panel?.querySelector<HTMLElement>("[data-selected='true']");
    if (!panel || !selected || panel.scrollHeight <= panel.clientHeight) return;
    const offset =
      selected.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
    panel.scrollTop = offset - (panel.clientHeight - selected.offsetHeight) / 2;
  }, [layout, panelRef]);
}

/**
 * The floating surface every dropdown shares: sized to the room it has,
 * scrolling with the menu scrollbar when its list is longer, and keeping the
 * wheel to itself (`overscroll-contain`) so reaching the end of the list
 * doesn't carry on scrolling the page underneath.
 *
 * Mount it only while open — placement is measured on mount. Exported for
 * menus that own their open state and dismissal (the project row's
 * multi-view menu); everything else should use `Menu`.
 */
export function MenuPanel({
  anchorRef,
  panelRef: externalRef,
  side = "bottom",
  align = "end",
  portal = false,
  className,
  children,
}: {
  /** The positioned (`relative`) box the panel hangs off — usually the trigger's wrapper. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Pass one when the owner needs the panel node too (click-outside tests). */
  panelRef?: RefObject<HTMLDivElement | null>;
  side?: Side;
  align?: Align;
  portal?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const panelRef = externalRef ?? localRef;
  const layout = usePanelLayout(anchorRef, panelRef, side, align, portal);
  useRevealSelected(layout, panelRef);

  const resolvedSide = layout?.side ?? side;
  const panel = (
    <div
      ref={panelRef}
      className={cn(
        "menu-scroll z-50 min-w-48 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface-3 p-1.5 shadow-2xl shadow-black/50",
        portal
          ? "fixed"
          : cn(
              "absolute",
              resolvedSide === "top" ? "bottom-full mb-2" : "top-full mt-2",
              align === "end" ? "end-0" : "start-0",
            ),
        // Hidden for the first frame, before it has been measured and capped.
        !layout && "pointer-events-none opacity-0",
        className,
      )}
      style={{
        maxHeight: layout?.maxHeight ?? MAX_PANEL_HEIGHT,
        ...(portal ? { top: layout?.top ?? 0, left: layout?.left ?? 0 } : null),
      }}
    >
      {children}
    </div>
  );

  return portal ? createPortal(panel, document.body) : panel;
}

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
  align?: Align;
  side?: Side;
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

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <MenuPanel
          anchorRef={ref}
          panelRef={panelRef}
          side={side}
          align={align}
          portal={portal}
          className={panelClassName}
        >
          {children({ close: () => setOpen(false) })}
        </MenuPanel>
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
  selected = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  /** Red text for delete/remove actions. */
  destructive?: boolean;
  /** The current choice — a long panel opens scrolled to it. */
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-selected={selected ? "true" : undefined}
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
