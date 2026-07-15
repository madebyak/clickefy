import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

type Plan = {
  id: "free" | "pro" | "proMax";
  price: string;
  periodKey: "forever" | "perMonth";
  credits: number;
  featureKeys: string[];
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "free",
    price: "$0",
    periodKey: "forever",
    credits: 50,
    featureKeys: ["standardModels", "watermarkFree", "communityTemplates"],
  },
  {
    id: "pro",
    price: "$19",
    periodKey: "perMonth",
    credits: 1500,
    featureKeys: ["allModelsPro", "priorityQueue", "storyboardCinema", "creditTopups"],
    highlight: true,
  },
  {
    id: "proMax",
    price: "$49",
    periodKey: "perMonth",
    credits: 5000,
    featureKeys: ["everythingInPro", "exports4k", "commercialLicense", "earlyAccess"],
  },
];

export async function PricingSection() {
  const t = await getTranslations("pricing");

  return (
    <section className="mx-auto mt-20 max-w-[90rem] px-4 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("heading")}</h2>
        <p className="mt-3 text-muted-foreground">{t("sub")}</p>
      </div>

      <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "relative flex flex-col rounded-2xl p-6 sm:p-7",
              plan.highlight ? "bg-surface-3" : "bg-surface-2",
            )}
          >
            {plan.highlight && (
              <span className="absolute end-6 top-6 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                {t("mostPopular")}
              </span>
            )}
            <h3 className="text-lg font-semibold">{t(`${plan.id}Name`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`${plan.id}Desc`)}</p>

            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
              <span className="text-sm text-muted-foreground">{t(plan.periodKey)}</span>
            </div>

            <ul className="mt-6 space-y-3">
              <li className="flex items-start gap-2.5 text-sm">
                <Check weight="bold" className="mt-0.5 size-4 shrink-0 text-brand-yellow" />
                <span className="text-muted-foreground">
                  {t("creditsPerMonth", { count: plan.credits.toLocaleString("en-US") })}
                </span>
              </li>
              {plan.featureKeys.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <Check weight="bold" className="mt-0.5 size-4 shrink-0 text-brand-yellow" />
                  <span className="text-muted-foreground">{t(f)}</span>
                </li>
              ))}
            </ul>

            <div className="flex-1" />

            <Link
              href="#"
              className={cn(
                "mt-8 inline-flex h-11 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                plan.highlight
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-surface-3 text-foreground hover:bg-surface-1",
              )}
            >
              {t(`${plan.id}Cta`)}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
