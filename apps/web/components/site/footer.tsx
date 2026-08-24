import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { XLogo, InstagramLogo, YoutubeLogo, TiktokLogo } from "@phosphor-icons/react/dist/ssr";

const COLUMNS = [
  {
    titleKey: "create",
    links: ["linkCreateImage", "linkCreateVideo", "linkStoryboard", "linkCinemaStudio", "linkAiUgc"],
  },
  { titleKey: "explore", links: ["linkTemplates", "linkModels", "linkPricing"] },
  { titleKey: "company", links: ["linkAbout", "linkBlog", "linkCareers", "linkContact"] },
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

/**
 * Real destinations per link key. Keys without a built page yet stay on
 * "#" until their feature ships (storyboard, company pages, …).
 */
const HREFS: Record<string, string> = {
  linkCreateImage: "/create",
  linkCreateVideo: "/create-video",
  linkTemplates: "/templates",
  linkPricing: "/pricing",
  linkPrivacy: "/privacy",
  linkTerms: "/terms",
  linkAccountDeletion: "/account-deletion",
  linkContentPolicy: "/content-policy",
  linkAiDisclosure: "/ai-disclosure",
  linkDmca: "/dmca",
};

const SOCIALS = [
  { Icon: XLogo, label: "X" },
  { Icon: InstagramLogo, label: "Instagram" },
  { Icon: YoutubeLogo, label: "YouTube" },
  { Icon: TiktokLogo, label: "TikTok" },
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
            <div className="mt-5 flex gap-2">
              {SOCIALS.map(({ Icon, label }) => (
                <Link
                  key={label}
                  href="#"
                  aria-label={label}
                  className="grid size-9 place-items-center rounded-lg bg-surface-2 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                  <Icon className="size-4" weight="fill" />
                </Link>
              ))}
            </div>
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
