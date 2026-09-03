import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { XLogo, InstagramLogo, YoutubeLogo, TiktokLogo } from "@phosphor-icons/react/dist/ssr";

const COLUMNS = [
  {
    titleKey: "create",
    links: ["linkCreateImage", "linkCreateVideo", "linkStoryboard", "linkCameraAngles"],
  },
  { titleKey: "explore", links: ["linkTemplates", "linkModels", "linkPricing"] },
  // Blog and Careers wait until those pages exist — no dead links.
  { titleKey: "company", links: ["linkAbout", "linkContact"] },
  {
    titleKey: "legal",
    links: [
      "linkPrivacy",
      "linkTerms",
      "linkAccountDeletion",
      "linkContentPolicy",
      "linkAiDisclosure",
      "linkDmca",
    ],
  },
] as const;

/** Real destinations per link key — every listed key has a built page. */
const HREFS: Record<string, string> = {
  linkCreateImage: "/create",
  linkCreateVideo: "/create-video",
  linkStoryboard: "/create?tool=storyboard",
  linkCameraAngles: "/create?tool=camera",
  linkTemplates: "/templates",
  linkModels: "/models",
  linkPricing: "/pricing",
  linkAbout: "/about",
  linkContact: "/contact",
  linkPrivacy: "/privacy",
  linkTerms: "/terms",
  linkAccountDeletion: "/account-deletion",
  linkContentPolicy: "/content-policy",
  linkAiDisclosure: "/ai-disclosure",
  linkDmca: "/dmca",
};

/**
 * Social accounts. An entry renders only once its `href` is filled in —
 * an icon that goes nowhere is worse than no icon.
 */
const SOCIALS: Array<{ Icon: typeof XLogo; label: string; href: string }> = [
  { Icon: XLogo, label: "X", href: "" },
  { Icon: InstagramLogo, label: "Instagram", href: "" },
  { Icon: YoutubeLogo, label: "YouTube", href: "" },
  { Icon: TiktokLogo, label: "TikTok", href: "" },
];

export async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="mt-20 bg-surface-1">
      <div className="mx-auto w-full max-w-site py-14 site-px">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-withsymbol.svg" alt="Clickefy" className="h-7 w-auto" />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">{t("tagline")}</p>
            {SOCIALS.some((s) => s.href) && (
              <div className="mt-5 flex gap-2">
                {SOCIALS.filter((s) => s.href).map(({ Icon, label, href }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="grid size-9 place-items-center rounded-lg bg-surface-2 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                  >
                    <Icon className="size-4" weight="fill" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {COLUMNS.map((col) => (
            <div key={col.titleKey}>
              <h4 className="text-sm font-semibold">{t(col.titleKey)}</h4>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l}>
                    <Link
                      href={HREFS[l] ?? "#"}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t(l)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 pt-8 text-sm text-muted-foreground sm:flex-row">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p>{t("builtForCreators")}</p>
        </div>
      </div>
    </footer>
  );
}
