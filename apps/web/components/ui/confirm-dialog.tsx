"use client";

/**
 * Confirm dialog on the native <dialog> element via showModal(): the
 * browser provides the real focus trap (rest of the document becomes
 * inert), Escape-to-close, top-layer stacking, and focus restoration
 * to the invoking element on close — the parts a hand-rolled div modal
 * gets wrong. Used for destructive actions (delete folder / project).
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      aria-describedby={body ? "confirm-dialog-body" : undefined}
      // `cancel` fires on Escape; `click` on the element itself means the
      // backdrop was hit (clicks inside land on descendants).
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-5 text-foreground shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id="confirm-dialog-title" className="text-base font-semibold">
        {title}
      </h2>
      {body ? (
        <p id="confirm-dialog-body" className="mt-2 text-sm text-muted-foreground">
          {body}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-lg bg-surface-3 px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          className={cn(
            "inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            destructive
              ? "bg-status-red text-white hover:bg-status-red/90 focus-visible:ring-status-red"
              : "bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-primary",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
