"use client";

/**
 * Cancelling, with the one thing a plain confirm dialog cannot do: ask why.
 *
 * The reason values are Stripe's own survey enum, so the answer lands in
 * their dashboard next to the subscription rather than in a table nobody
 * opens. That is also why this is a dialog and not a one-click button —
 * the question is worth asking, and the moment someone is leaving is the
 * only moment they will answer it honestly.
 *
 * It states the date access actually ends. "Cancel" reads as "cut me off
 * now" to most people, and being surprised by a month you thought you had
 * lost is a support ticket at best.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Stripe's `cancellation_details.feedback` values. */
const REASONS = [
  "too_expensive",
  "missing_features",
  "unused",
  "switched_service",
  "too_complex",
  "low_quality",
  "customer_service",
  "other",
] as const;

export function CancelDialog({
  accessUntil,
  pending,
  onConfirm,
  onClose,
}: {
  /** Already formatted for the current locale. */
  accessUntil: string | null;
  pending: boolean;
  onConfirm: (input: { reason?: string; comment?: string }) => void;
  onClose: () => void;
}) {
  const t = useTranslations("billing");
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  return (
    <Modal onClose={onClose} label={t("cancelTitle")} className="w-[min(30rem,calc(100vw-2rem))]">
      <div className="p-5">
        <h2 className="text-lg font-semibold">{t("cancelTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {accessUntil ? t("cancelBodyUntil", { date: accessUntil }) : t("cancelBody")}
        </p>

        <p className="mt-5 text-sm font-medium">{t("cancelReasonLabel")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(reason === r ? null : r)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                reason === r
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`cancelReason_${r}` as never)}
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("cancelCommentPlaceholder")}
          maxLength={500}
          rows={3}
          dir="auto"
          className="mt-3 w-full resize-none rounded-lg bg-surface-1 p-3 text-sm outline-none ring-1 ring-border focus:ring-primary"
        />

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("keepPlan")}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            className="border border-status-red/40 text-status-red hover:bg-status-red/10 hover:text-status-red"
            onClick={() =>
              onConfirm({
                ...(reason ? { reason } : {}),
                ...(comment.trim() ? { comment: comment.trim() } : {}),
              })
            }
          >
            {pending ? t("cancelling") : t("cancelConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
