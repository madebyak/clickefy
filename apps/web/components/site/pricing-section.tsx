"use client";

/**
 * Pricing — five columns: Free plus the four paid tiers.
 *
 * Everything numeric comes from `GET /v1/billing/plans`, never from a
 * constant in this file. The previous version hardcoded Free / Pro $19
 * (1,500 credits) / Pro Max $49 (5,000 credits), all three of which had
 * drifted from what the product actually sells, and its buy button linked
 * to `href="#"`. A marketing page quoting credit amounts that disagree
 * with what a customer receives is worse than one that quotes none.
 *
 * Prices live here because Stripe is the source of truth for what is
 * charged and we cannot read it without a session; the CREDITS — the part
 * that can silently diverge from the product — come from the database.
 *
 * Cross-platform: someone subscribed through Apple or Google sees their
 * plan marked current and is pointed back to the app, because Stripe
 * cannot replace a store subscription. Charging them here would bill them
 * twice.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Check, ArrowUpRight } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { useBillingActions } from "@/lib/use-billing-actions";
import {
  purchaseState,
  usePlans,
  type CataloguePlan,
  type PlanInterval,
  type PlanTier,
} from "@/lib/use-plans";

/**
 * Display price per tier. Stripe is authoritative for what is actually
 * charged — these drive the marketing page only, and the checkout session
 * always prices from Stripe itself.
 */
const PRICE_USD: Record<PlanTier, { month: number; year: number }> = {
  basic: { month: 19, year: 190 },
  creator: { month: 39, year: 390 },
  pro: { month: 75, year: 750 },
  ultimate: { month: 99, year: 990 },
};

const TIER_ORDER: PlanTier[] = ["basic", "creator", "pro", "ultimate"];
const HIGHLIGHT: PlanTier = "creator";

/** Feature lines per tier — cumulative, so each reads as a step up. */
const FEATURES: Record<PlanTier, string[]> = {
  basic: ["allModels", "watermarkFree", "creditsRollover"],
  creator: ["allModels", "priorityQueue", "topupPacks", "communityTemplates"],
  pro: ["allModels", "priorityQueue", "topupPacks", "commercialLicense"],
  ultimate: ["allModels", "priorityQueue", "topupPacks", "commercialLicense"],
};

function Feature({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Check weight="bold" className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}

/**
 * Resume a checkout that was interrupted by sign-up.
 *
 * Clicking a plan while signed out sends the visitor to Clerk with the
 * plan id in `redirect_url`, so they come back here as `/?plan=<id>`.
 * Without this hook that parameter is inert: they would arrive at a
 * pricing page that has forgotten which plan they chose and have to find
 * it and click again, having already declared their intent once.
 *
 * The parameter is stripped BEFORE the redirect fires. If Stripe or our
 * API rejects the checkout, or they press back, a lingering `?plan=`
 * would re-trigger this on every render — an endless bounce out to a
 * checkout they cannot complete. Firing once, from a URL that no longer
 * says to, is the safe shape. The ref guards against React 18 double
 * effects in development.
 *
 * The router is the locale-aware one — plain `next/navigation` would drop
 * the `/ar` prefix and flip an Arabic visitor to English mid-purchase.
 */
function useResumeCheckout(startCheckout: (planId: string) => void, ready: boolean) {
  const { isLoaded, isSignedIn } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    const planId = params.get("plan");
    if (!planId || fired.current || !ready || !isLoaded || !isSignedIn) return;
    fired.current = true;
    router.replace("/#pricing");
    startCheckout(planId);
  }, [params, ready, isLoaded, isSignedIn, router, startCheckout]);
}

/**
 * `embedded` is for the dedicated /pricing page, which supplies its own
 * headline and puts the FAQ after the model table. Without it that page
 * would carry two competing headings and an FAQ stranded mid-page.
 */
/**
 * Renders nothing. Exists so `useSearchParams` is isolated behind its own
 * Suspense boundary.
 *
 * That hook SUSPENDS during prerender, and a statically generated page
 * that calls it without a boundary fails its production build outright —
 * while working perfectly in `next dev`, where routes render on demand.
 * The home page is dynamic and never tripped it; /pricing is static and
 * broke the build the moment it existed.
 *
 * Wrapping the whole section instead would have been the obvious fix and
 * the wrong one: the fallback would replace the CARDS in the static HTML,
 * costing the pricing page its server-rendered content. Isolating the
 * hook here keeps every card prerendered and confines the boundary to a
 * component that renders nothing anyway.
 */
function ResumeCheckout({
  startCheckout,
  ready,
}: {
  startCheckout: (planId: string) => void;
  ready: boolean;
}) {
  useResumeCheckout(startCheckout, ready);
  return null;
}

export function PricingSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslations("pricing");
  const [interval, setInterval] = useState<PlanInterval>("month");
  const { data, isLoading } = usePlans();
  const { startCheckout, pendingPlanId } = useBillingActions();

  const { canBuy, managedOn } = purchaseState(data?.current ?? null);
  const byTier = new Map<string, CataloguePlan>();
  for (const p of data?.plans ?? []) {
    if (p.interval === interval) byTier.set(p.tier, p);
  }

  return (
    <section
      id="pricing"
      className={cn("mx-auto max-w-[90rem] px-4 sm:px-6", embedded ? "mt-0" : "mt-20")}
    >
      <Suspense fallback={null}>
        <ResumeCheckout startCheckout={startCheckout} ready={!isLoading} />
      </Suspense>

      {!embedded && (
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("heading")}</h2>
          <p className="mt-3 text-muted-foreground">{t("sub")}</p>
        </div>
      )}

      {/* Monthly / yearly toggle. The saving is stated as "2 months free"
          rather than a percentage — it is the same offer, and people can
          picture two months in a way they cannot picture 16.7%. */}
      <div className={cn("flex items-center justify-center", embedded ? "mt-0" : "mt-8")}>
        <div className="inline-flex rounded-full bg-surface-2 p-1">
          {(["month", "year"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setInterval(opt)}
              aria-pressed={interval === opt}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                interval === opt
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(opt === "month" ? "monthly" : "yearly")}
              {opt === "year" && (
                <span className="ms-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {t("saveTwoMonths")}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Someone already subscribed through a store cannot be sold to here,
          so say so once, plainly, above the grid. */}
      {managedOn && managedOn !== "web" && (
        <p className="mx-auto mt-6 max-w-xl rounded-xl bg-surface-2 px-4 py-3 text-center text-sm text-muted-foreground">
          {t("subscribedElsewhere", {
            platform: t(managedOn === "ios" ? "platformIos" : "platformAndroid"),
          })}
        </p>
      )}

      <div className="mx-auto mt-10 grid max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Free — a real option, so it gets a real column. */}
        <div className="flex flex-col rounded-2xl bg-surface-2 p-6">
          <h3 className="text-lg font-semibold">{t("freeName")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("freeDesc")}</p>
          <p className="mt-5 flex items-baseline gap-1">
            <span className="text-3xl font-semibold tracking-tight">$0</span>
            <span className="text-sm text-muted-foreground">{t("forever")}</span>
          </p>
          <p className="mt-2 text-sm font-medium">
            {isLoading ? "—" : t("freeCredits", { count: data?.freeCredits ?? 0 })}
          </p>
          <ul className="mt-6 space-y-2.5">
            <Feature label={t("watermarkFree")} />
            <Feature label={t("communityTemplates")} />
            <Feature label={t("creditsNeverExpire")} />
          </ul>
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-6 w-full")}
          >
            {t("freeCta")}
          </Link>
        </div>

        {TIER_ORDER.map((tier) => {
          const plan = byTier.get(tier);
          const price = PRICE_USD[tier][interval === "month" ? "month" : "year"];
          const isCurrent = data?.current?.tier === tier;
          const highlighted = tier === HIGHLIGHT && !isCurrent;
          // A tier with no storefront product cannot be bought yet. Better
          // an honest "coming soon" than a button that leads nowhere —
          // which is exactly what the old page did.
          //
          // But "not loaded yet" is NOT the same as "not for sale", and
          // this component server-renders before the catalogue arrives.
          // Without the isLoading guard every visitor sees "Coming soon"
          // flash on plans they can actually buy — worse than a plain
          // placeholder, because it actively tells them not to try.
          const sellable = !!plan && Object.keys(plan.products).length > 0;
          const unknownYet = isLoading || !plan;

          return (
            <div
              key={tier}
              className={cn(
                "relative flex flex-col rounded-2xl p-6",
                highlighted ? "bg-surface-3 ring-1 ring-primary/30" : "bg-surface-2",
                isCurrent && "ring-1 ring-primary",
              )}
            >
              {(highlighted || isCurrent) && (
                <span className="absolute end-6 top-6 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  {isCurrent ? t("currentPlan") : t("mostPopular")}
                </span>
              )}

              <h3 className="text-lg font-semibold">{t(`${tier}Name`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`${tier}Desc`)}</p>

              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">${price}</span>
                <span className="text-sm text-muted-foreground">
                  {t(interval === "month" ? "perMonth" : "perYear")}
                </span>
              </p>

              {/* The credit figure is the number a customer will hold us to,
                  so it comes from the database rather than this file. */}
              <p className="mt-2 text-sm font-medium">
                {isLoading || !plan
                  ? "—"
                  : t("creditsIncluded", { count: plan.creditsPerPeriod.toLocaleString() })}
              </p>

              <ul className="mt-6 space-y-2.5">
                {FEATURES[tier].map((k) => (
                  <Feature key={k} label={t(k)} />
                ))}
              </ul>

              <div className="mt-6 flex-1" />

              {isCurrent ? (
                <span
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full cursor-default opacity-70",
                  )}
                >
                  {t("currentPlan")}
                </span>
              ) : !canBuy ? (
                <span
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "w-full cursor-default justify-between opacity-70",
                  )}
                >
                  {t("manageInApp")}
                  <ArrowUpRight className="size-4 rtl:-scale-x-100" />
                </span>
              ) : unknownYet ? (
                <span
                  aria-hidden
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full cursor-default opacity-40",
                  )}
                >
                  &nbsp;
                </span>
              ) : sellable ? (
                <button
                  type="button"
                  disabled={pendingPlanId !== null}
                  onClick={() => startCheckout(plan!.id)}
                  className={cn(
                    buttonVariants({ variant: highlighted ? "primary" : "outline", size: "sm" }),
                    "w-full",
                    pendingPlanId !== null && "pointer-events-none opacity-60",
                  )}
                >
                  {pendingPlanId === plan!.id
                    ? t("starting")
                    : t("choosePlan", { plan: t(`${tier}Name`) })}
                </button>
              ) : (
                <span
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full cursor-default opacity-50",
                  )}
                >
                  {t("comingSoon")}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* The questions people actually ask before paying — especially why
          the app costs more, which is better answered than left to guess.
          The dedicated page renders this itself, after the model table. */}
      <div className={cn("mx-auto mt-16 max-w-3xl", embedded && "hidden")}>
        <h3 className="text-center text-xl font-semibold">{t("faqTitle")}</h3>
        <dl className="mt-6 space-y-4">
          {(["Credits", "Reset", "Cancel", "Mobile"] as const).map((k) => (
            <div key={k} className="rounded-xl bg-surface-2 p-5">
              <dt className="font-medium">{t(`faq${k}Q`)}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">{t(`faq${k}A`)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
