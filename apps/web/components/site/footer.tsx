import Link from "next/link";
import {
  XLogo,
  InstagramLogo,
  YoutubeLogo,
  TiktokLogo,
} from "@phosphor-icons/react/dist/ssr";

const COLUMNS = [
  {
    title: "Create",
    links: ["Create Image", "Create Video", "Storyboard", "Cinema Studio", "AI UGC"],
  },
  { title: "Explore", links: ["Templates", "Models", "Pricing"] },
  { title: "Company", links: ["About", "Blog", "Careers", "Contact"] },
  { title: "Legal", links: ["Privacy Policy", "Terms of Service", "Account Deletion", "Content Policy"] },
];

const SOCIALS = [
  { Icon: XLogo, label: "X" },
  { Icon: InstagramLogo, label: "Instagram" },
  { Icon: YoutubeLogo, label: "YouTube" },
  { Icon: TiktokLogo, label: "TikTok" },
];

export function Footer() {
  return (
    <footer className="mt-20 bg-surface-1">
      <div className="mx-auto max-w-[90rem] px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
          {/* brand */}
          <div className="lg:col-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-withsymbol.svg" alt="Clickefy" className="h-7 w-auto" />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Professional AI image &amp; video creation studio for creators and teams.
            </p>
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

          {/* link columns */}
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold">{col.title}</h4>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l}>
                    <Link href="#" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                      {l}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 pt-8 text-sm text-muted-foreground sm:flex-row">
          <p>© 2026 Cast U FZE LLC. All rights reserved.</p>
          <p>Built for creators.</p>
        </div>
      </div>
    </footer>
  );
}
