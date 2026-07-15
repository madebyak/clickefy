import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

export async function VideoBanner() {
  const t = await getTranslations("home");

  return (
    <section className="mx-auto mt-16 max-w-[90rem] px-4 sm:px-6">
      <div className="relative overflow-hidden rounded-2xl bg-surface-2">
        <video
          className="absolute inset-0 size-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        >
          <source src="/assets/banner-home.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/55" />

        <div className="relative z-10 flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center sm:min-h-[400px] lg:min-h-[480px]">
          <p className="font-mono text-xs uppercase tracking-widest text-brand-yellow">
            {t("bannerLabel")}
          </p>
          <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            {t("bannerHeadline")}
          </h2>
          <p className="mt-4 max-w-xl text-base text-white/70 sm:text-lg">{t("bannerSub")}</p>
          <Link
            href="/create"
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("startCreating")} <ArrowRight className="size-4 rtl:-scale-x-100" weight="bold" />
          </Link>
        </div>
      </div>
    </section>
  );
}
