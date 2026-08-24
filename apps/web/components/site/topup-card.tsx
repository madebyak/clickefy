"use client";

/**
 * Top-up card — buy extra credits without changing plan.
 *
 * A SLIDER OVER DISCRETE PACKS, not a free-form amount. The underlying
 * products are five fixed Stripe prices, so letting someone drag to
 * "7,300 credits" would be a lie the checkout could not honour. The
 * control is a native `<input type="range">` whose value is the pack
 * INDEX (0–4), which snaps by construction: there is no invalid position
 * to land on.
 *
 * Native range, not a custom widget, because keyboard support, focus
 * handling, touch targets and screen-reader semantics all come free and
 * all get reimplemented badly otherwise. The one thing it cannot know is
 * that "3" means "11,500 credits for $100", so `aria-valuetext` says so.
 *
 * The bonus is the whole pitch of the ladder, so it is stated as its own
 * line rather than folded silently into the total — someone comparing
 * $50 to $100 should see that the bigger pack is not merely bigger.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Lightning, Lock } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useBillingActions } from "@/lib/use-billing-actions";
import { usePlans, type CataloguePack } from "@/lib/use-plans";

function formatUsd(v: number): string {
  // Whole dollars — every pack is priced round on purpose, and "$50.00"
  // in a slider reads as noise.
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

/** Short tick label under the slider: 1k, 2.5k, 25k. */
function tickLabel(pack: CataloguePack): string {
  const n = pack.credits;
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(n);
}

export function TopupCard() {
  const t = useTranslations("pricing");
  const { data, isLoading } = usePlans();
  const { startTopup, pendingPackId } = useBillingActions();

  const packs = useMemo(
    () => [...(data?.packs ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [data?.packs],
  );

  // `null` means "the user has not chosen yet", so the featured pack can
  // be DERIVED rather than written by an effect.
  //
  // The effect version of this was a bug: react-query refetches on window
  // focus, which changes the `packs` identity, which re-ran the effect and
  // silently reset the slider. Someone who picked the 25k pack, switched
  // tabs to check their budget, and came back would find $50 selected
  // again. Deriving the default removes the failure mode instead of
  // guarding against it.
  const [chosen, setChosen] = useState<number | null>(null);

  const defaultIndex = useMemo(() => {
    const featured = packs.findIndex((p) => p.isFeatured);
    return featured >= 0 ? featured : Math.floor(packs.length / 2);
  }, [packs]);

  if (isLoading) {
    return (
      <section className="mx-auto mt-24 w-full max-w-site site-px">
        <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-2xl bg-surface-2" />
      </section>
    );
  }
  // Nothing to sell yet — say nothing rather than render an empty control.
  if (packs.length === 0) return null;

  // Clamped, so a catalogue that shrinks under a stale selection cannot
  // index off the end.
  const index = Math.min(chosen ?? defaultIndex, packs.length - 1);
  const pack = packs[index]!;
  const locked = data?.topupsLocked ?? true;
  const canBuy = pack.purchasable && !locked;
  const busy = pendingPackId !== null;

  return (
    <section className="mx-auto mt-24 w-full max-w-site site-px">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-surface-2 p-6 ring-1 ring-border sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("topupHeading")}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("topupSub")}</p>
          </div>
          <span className="hidden shrink-0 rounded-xl bg-surface-3 p-2.5 sm:block">
            <Lightning weight="fill" className="size-5 text-primary" />
          </span>
        </div>

        {/* The number they are buying, given the most visual weight on the
            card — it is the thing being chosen. */}
        <div className="mt-8 text-center">
          <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
            {pack.totalCredits.toLocaleString()}
            <span className="ms-2 text-base font-normal text-muted-foreground">
              {t("creditsWord")}
            </span>
          </p>
          {pack.bonusCredits > 0 ? (
            <p className="mt-2 text-sm text-primary">
              {t("topupBonus", {
                base: pack.credits.toLocaleString(),
                bonus: pack.bonusCredits.toLocaleString(),
              })}
            </p>
          ) : (
            // Reserve the line so the card does not jump height between steps.
            <p className="mt-2 text-sm text-transparent" aria-hidden>
              &nbsp;
            </p>
          )}
        </div>

        <div className="mt-7">
          <label htmlFor="topup-range" className="sr-only">
            {t("topupSliderLabel")}
          </label>
          <input
            id="topup-range"
            type="range"
            min={0}
            max={packs.length - 1}
            step={1}
            value={index}
            onChange={(e) => setChosen(Number(e.target.value))}
            // The raw value is an index; without this a screen reader
            // announces "3 of 4", which describes the control rather than
            // the purchase.
            aria-valuetext={t("topupAriaValue", {
              credits: pack.totalCredits.toLocaleString(),
              price: pack.priceUsd != null ? formatUsd(pack.priceUsd) : "—",
            })}
            className={cn(
              "h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-3",
              "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
              "[&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none",
              "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
              "[&::-webkit-slider-thumb]:ring-4 [&::-webkit-slider-thumb]:ring-surface-2",
              "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:appearance-none",
              "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0",
              "[&::-moz-range-thumb]:bg-primary",
            )}
          />

          {/* Ticks double as buttons: dragging a slider to an exact step is
              fiddly on a phone, and these are the same five choices. */}
          <div className="mt-3 flex justify-between">
            {packs.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setChosen(i)}
                aria-pressed={i === index}
                className={cn(
                  "-mx-1 rounded px-1 text-xs tabular-nums transition-colors",
                  i === index
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tickLabel(p)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">
              {pack.priceUsd != null ? formatUsd(pack.priceUsd) : "—"}
            </span>
            {pack.priceUsd != null && (
              <span className="text-xs text-muted-foreground">
                {t("topupPerCredit", {
                  rate: (pack.priceUsd / pack.totalCredits).toFixed(3),
                })}
              </span>
            )}
          </p>

          {canBuy ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startTopup(pack.id)}
              className={cn(
                buttonVariants({ variant: "primary" }),
                "w-full sm:w-auto",
                busy && "pointer-events-none opacity-60",
              )}
            >
              {pendingPackId === pack.id
                ? t("starting")
                : t("topupCta", { credits: pack.totalCredits.toLocaleString() })}
            </button>
          ) : (
            // Locked is the common case for a visitor, so it explains
            // itself rather than showing a dead button.
            <span
              className={cn(
                buttonVariants({ variant: "outline" }),
                "w-full cursor-default gap-2 opacity-70 sm:w-auto",
              )}
            >
              <Lock weight="fill" className="size-4" />
              {pack.purchasable ? t("topupLocked") : t("comingSoon")}
            </span>
          )}
        </div>

        <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
          {t("topupFootnote")}
        </p>
      </div>
    </section>
  );
}
