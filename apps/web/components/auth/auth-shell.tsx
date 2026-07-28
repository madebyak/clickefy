import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const PANEL_VIDEO = "/assets/Kling-Images-2.mp4";

/**
 * Shared split layout for the sign-in / sign-up pages: a full-bleed
 * brand panel (video + tagline) on the start side, the Clerk card on
 * the end side. The panel collapses away below lg so mobile gets a
 * clean centered card with the logo on top.
 */
export async function AuthShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* brand panel */}
      <div className="relative hidden w-1/2 overflow-hidden lg:block">
        <video
          src={PANEL_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Link href="/" aria-label="Clickefy">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-withsymbol.svg" alt="Clickefy" className="h-7 w-auto" />
          </Link>
          <div className="max-w-md">
            <p className="text-sm font-medium uppercase tracking-widest text-primary">
              {t("panelBadge")}
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight">{t("panelTitle")}</h1>
            <p className="mt-4 text-base text-white/70">{t("panelSubtitle")}</p>
          </div>
        </div>
      </div>

      {/* form side */}
      <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-8 p-6">
        <Link href="/" aria-label="Clickefy" className="lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-withsymbol.svg" alt="Clickefy" className="h-7 w-auto" />
        </Link>
        {children}
      </div>
    </div>
  );
}
