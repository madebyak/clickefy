import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { LEGAL_DOCS, LEGAL_DOC_ORDER, type LegalDocSlug } from "@/lib/legal-content";

/**
 * Shared renderer for the public legal pages. Server-rendered inside the
 * marketing shell; content is the legally-reviewed English text (chrome
 * strings are localized). Cross-links the rest of the legal pack.
 */
export async function LegalDocPage({
  slug,
  locale,
}: {
  slug: LegalDocSlug;
  locale: string;
}) {
  setRequestLocale(locale);
  const t = await getTranslations("legal");
  const doc = LEGAL_DOCS[slug];
  const others = LEGAL_DOC_ORDER.filter((s) => s !== slug);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />
      {/* Legal text is English; keep direction LTR even on /ar. */}
      <main dir="ltr" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">
          {t("kicker")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-muted-foreground">{doc.summary}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("effective", { date: doc.effectiveDate })}
        </p>

        <div className="mt-10 space-y-8">
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-lg font-semibold">{s.heading}</h2>
              {s.paragraphs.map((p, i) => (
                <p key={i} className="mt-3 text-[15px] leading-7 text-foreground/85">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div className="mt-14 border-t border-border pt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("otherDocs")}</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {others.map((s) => (
              <li key={s}>
                <Link
                  href={`/${s}`}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  {LEGAL_DOCS[s].title}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/account-deletion"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                {t("accountDeletionTitle")}
              </Link>
            </li>
          </ul>
        </div>
      </main>
      <Footer />
    </div>
  );
}
