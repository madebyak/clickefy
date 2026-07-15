import { Link } from "@/i18n/navigation";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

type Plan = {
  name: string;
  desc: string;
  price: string;
  period: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    desc: "Try the studio, no commitment.",
    price: "$0",
    period: "forever",
    features: ["50 credits / month", "Standard models", "Watermark-free exports", "Community templates"],
    cta: "Get started",
  },
  {
    name: "Pro",
    desc: "For creators shipping regularly.",
    price: "$19",
    period: "/ month",
    features: [
      "1,500 credits / month",
      "All models, incl. Pro",
      "Priority generation queue",
      "Storyboard & Cinema Studio",
      "Credit top-ups",
    ],
    cta: "Upgrade to Pro",
    highlight: true,
    badge: "Most popular",
  },
  {
    name: "Pro Max",
    desc: "For teams and heavy output.",
    price: "$49",
    period: "/ month",
    features: [
      "5,000 credits / month",
      "Everything in Pro",
      "4K exports",
      "Commercial license",
      "Early access to new models",
    ],
    cta: "Go Pro Max",
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl p-6 sm:p-7",
        plan.highlight ? "bg-surface-3" : "bg-surface-2",
      )}
    >
      {plan.badge && (
        <span className="absolute end-6 top-6 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
          {plan.badge}
        </span>
      )}
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{plan.desc}</p>

      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
        <span className="text-sm text-muted-foreground">{plan.period}</span>
      </div>

      <ul className="mt-6 space-y-3">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check weight="bold" className="mt-0.5 size-4 shrink-0 text-brand-yellow" />
            <span className="text-muted-foreground">{f}</span>
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
        {plan.cta}
      </Link>
    </div>
  );
}

export function PricingSection() {
  return (
    <section className="mx-auto mt-20 max-w-[90rem] px-4 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Simple, credit-based pricing
        </h2>
        <p className="mt-3 text-muted-foreground">
          Start free. Upgrade when you need more credits, models and resolution.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-3">
        {PLANS.map((p) => (
          <PlanCard key={p.name} plan={p} />
        ))}
      </div>
    </section>
  );
}
