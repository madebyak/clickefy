"use client";

/**
 * "How far do my credits actually go?"
 *
 * A credit figure is abstract. 4,500 credits means nothing until it is
 * restated as 225 Nano Banana images or 71 Kling clips — which is the
 * question every visitor is silently doing arithmetic on before they
 * decide to pay. This table does that arithmetic for them.
 *
 * Every number here is DERIVED, never typed: plan allowances and model
 * prices both come from `GET /v1/billing/plans`, which reads the same
 * `plans` and `provider_models` rows the job route charges against. A
 * marketing table that disagrees with the meter is worse than no table,
 * because it reads as a promise.
 *
 * Prices are quoted at each model's DEFAULT quality and clip length —
 * what it costs to press Generate without touching a setting. Higher
 * settings cost more, which the footnote says plainly rather than
 * burying.
 */

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { usePlans, type CatalogueModel, type PlanTier } from "@/lib/use-plans";

const TIER_ORDER: PlanTier[] = ["basic", "creator", "pro", "ultimate"];
const HIGHLIGHT: PlanTier = "creator";

/** Columns, left to right. Free is first because it is where people start. */
interface Column {
  key: string;
  label: string;
  credits: number;
  /** Free credits are a one-off welcome grant, not a monthly allowance. */
  recurring: boolean;
  highlight: boolean;
}

/**
 * Generations one allowance buys of one model.
 *
 * `floor`, never `round`: telling someone they get 7 videos when the
 * seventh would leave them 12 credits short is the kind of small lie
 * that arrives as a support ticket.
 */
function generations(credits: number, unitCost: number): number {
  if (unitCost <= 0) return 0;
  return Math.floor(credits / unitCost);
}

function ModelRow({
  model,
  columns,
  t,
}: {
  model: CatalogueModel;
  columns: Column[];
  t: ReturnType<typeof useTranslations>;
}) {
  // "40 cr · 1K" for an image, "63 cr · 720p · 5s" for a clip — the
  // settings the price assumes, so nobody has to guess.
  const spec = [
    t("perGeneration", { count: model.credits }),
    model.quality,
    model.seconds ? `${model.seconds}s` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className="border-t border-border/60">
      <th
        scope="row"
        className="sticky start-0 z-10 w-[13.5rem] min-w-[13.5rem] bg-surface-1 py-3.5 pe-4 ps-4 text-start font-normal after:absolute after:inset-y-0 after:end-0 after:w-px after:bg-border sm:ps-6"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{model.name}</span>
          {model.preview && (
            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("preview")}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{spec}</span>
      </th>

      {columns.map((col) => {
        const n = generations(col.credits, model.credits);
        return (
          <td
            key={col.key}
            className={cn(
              "px-3 py-3.5 text-center tabular-nums",
              col.highlight && "bg-primary/[0.04]",
              n === 0 ? "text-muted-foreground/50" : "text-foreground",
            )}
          >
            {/* An em dash, not "0" — the plan does not stretch to one of
                these, and a zero reads like a broken calculation. */}
            {n === 0 ? "—" : n.toLocaleString()}
          </td>
        );
      })}
    </tr>
  );
}

function GroupHeading({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <td
        colSpan={span}
        className="bg-surface-2/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-6"
      >
        {label}
      </td>
    </tr>
  );
}

export function ModelAllowanceTable() {
  const t = useTranslations("pricing");
  const { data, isLoading } = usePlans();

  // Allowances are per 30 days on EVERY plan, yearly included, so this
  // table does not change with the billing toggle — reading the monthly
  // rows is enough and avoids implying a yearly plan front-loads credits.
  const creditsByTier = new Map<string, number>();
  for (const p of data?.plans ?? []) {
    if (p.interval === "month") creditsByTier.set(p.tier, p.creditsPerPeriod);
  }

  const columns: Column[] = [
    {
      key: "free",
      label: t("freeName"),
      credits: data?.freeCredits ?? 0,
      recurring: false,
      highlight: false,
    },
    ...TIER_ORDER.map((tier) => ({
      key: tier,
      label: t(`${tier}Name`),
      credits: creditsByTier.get(tier) ?? 0,
      recurring: true,
      highlight: tier === HIGHLIGHT,
    })),
  ];

  const models = data?.models ?? [];
  const images = models.filter((m) => m.kind === "image");
  const videos = models.filter((m) => m.kind === "video");
  const span = columns.length + 1;

  return (
    <section className="mx-auto mt-24 w-full max-w-site site-px">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("tableHeading")}
        </h2>
        <p className="mt-3 text-muted-foreground">{t("tableSub")}</p>
      </div>

      <div className="mx-auto mt-10 max-w-7xl overflow-hidden rounded-2xl bg-surface-1 ring-1 ring-border">
        {/* The table is wider than a phone. It scrolls inside its own box
            with the model name pinned, so a reader never loses which row
            they are on — the page itself never scrolls sideways. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">{t("tableHeading")}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky start-0 z-10 w-[13.5rem] min-w-[13.5rem] bg-surface-1 px-4 py-4 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground after:absolute after:inset-y-0 after:end-0 after:w-px after:bg-border sm:px-6"
                >
                  {t("tableModelCol")}
                </th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      "px-3 py-4 text-center align-bottom",
                      col.highlight && "bg-primary/[0.06]",
                    )}
                  >
                    <span className="block text-sm font-semibold text-foreground">
                      {col.label}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {isLoading
                        ? "—"
                        : col.recurring
                          ? t("creditsPerMonthShort", {
                              count: col.credits.toLocaleString(),
                            })
                          : t("creditsOnce", { count: col.credits.toLocaleString() })}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={span} className="px-6 py-16 text-center text-muted-foreground">
                    {t("tableLoading")}
                  </td>
                </tr>
              ) : (
                <>
                  {images.length > 0 && (
                    <>
                      <GroupHeading label={t("groupImages")} span={span} />
                      {images.map((m) => (
                        <ModelRow key={m.key} model={m} columns={columns} t={t} />
                      ))}
                    </>
                  )}
                  {videos.length > 0 && (
                    <>
                      <GroupHeading label={t("groupVideo")} span={span} />
                      {videos.map((m) => (
                        <ModelRow key={m.key} model={m} columns={columns} t={t} />
                      ))}
                    </>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-muted-foreground">
        {t("tableFootnote")}
      </p>
    </section>
  );
}
