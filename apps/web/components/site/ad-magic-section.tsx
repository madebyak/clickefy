import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { Link } from "@/i18n/navigation";

/**
 * The homepage's pitch for Ad Magic: product photos in, a finished
 * 15-second commercial out. Copy on the left, a phone-framed still on the
 * right so the Reels shape is obvious before anyone clicks. The CTA
 * deep-links straight into the tool (ToolDeepLink reads `?tool=ad`).
 */
export async function AdMagicSection() {
  const t = await getTranslations("home");
  const steps = ["adMagicStep1", "adMagicStep2", "adMagicStep3"] as const;

  return (
    <section className="mx-auto mt-10 w-full max-w-site site-px sm:mt-14">
      <div className="relative overflow-hidden rounded-2xl bg-surface-2">
        <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(7,221,68,0.16),transparent_55%),radial-gradient(90%_90%_at_100%_100%,rgba(219,0,120,0.18),transparent_60%)]" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-12 lg:gap-10 lg:p-12">
          {/* ---- copy ---- */}
          <div className="flex flex-col justify-center lg:col-span-7">
            <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-brand-green">
              <Sparkle weight="fill" className="size-4" />
              {t("adMagicEyebrow")}
              <span className="rounded bg-brand-green px-1.5 py-px text-[10px] font-semibold text-black">
                {t("new")}
              </span>
            </p>
            <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl">
              {t("adMagicHeadline")}
            </h2>
            <p className="mt-4 max-w-lg text-base text-muted-foreground sm:text-lg">{t("adMagicSub")}</p>

            <ol className="mt-6 grid gap-3 sm:grid-cols-3">
              {steps.map((key, i) => (
                <li key={key} className="flex items-start gap-3 rounded-xl bg-background/60 p-3 backdrop-blur-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-green text-sm font-semibold text-black">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-snug text-foreground">{t(key)}</span>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/create?tool=ad"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {t("adMagicCta")} <ArrowRight className="size-4 rtl:-scale-x-100" weight="bold" />
              </Link>
              <span className="text-sm text-muted-foreground">{t("adMagicSpec")}</span>
            </div>
          </div>

          {/* ---- phone frame ---- */}
          <div className="flex items-center justify-center lg:col-span-5">
            <div className="relative aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-[2rem] border-[6px] border-black/80 bg-black shadow-2xl shadow-black/50">
              <Image
                src="/assets/new/hero-4.jpg"
                alt=""
                fill
                sizes="260px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
              <span className="absolute start-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                {t("adMagicFrameTag")}
              </span>
              <div className="absolute inset-x-4 bottom-4">
                <p className="text-sm font-semibold text-white">{t("adMagicFrameTitle")}</p>
                <p className="mt-0.5 text-xs text-white/70">{t("adMagicFrameSub")}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full w-2/3 rounded-full bg-brand-green" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
