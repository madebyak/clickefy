import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { localizedPageMetadata } from "@/lib/page-metadata";

/**
 * Public account & data deletion page — required by Google Play's Data
 * safety form ("Delete account URL") and referenced by Apple review.
 * Must satisfy Google's three requirements: (a) name the app +
 * developer, (b) prominently show the deletion steps, (c) state what is
 * deleted vs retained and for how long (docs/WEB_LEGAL_HANDOFF.md).
 * Reachable without auth; content is the reviewed English text.
 */

const COMPANY = "Cast U FZE LLC";
const CONTACT = "support@clickefy.ai";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: "Delete your Clickefy account and data — Clickefy",
    description:
      "How to delete your Clickefy account and the personal data associated with it, and what happens to your data when you do.",
    ...localizedPageMetadata(locale, "/account-deletion"),
  };
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <span className="text-[15px] leading-6 text-foreground/85">{children}</span>
    </li>
  );
}

export default async function AccountDeletionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />
      <main dir="ltr" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">{t("kicker")}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Delete your Clickefy account and data
        </h1>
        <p className="mt-3 text-[15px] leading-7 text-foreground/85">
          <strong>Clickefy</strong> is operated by <strong>{COMPANY}</strong>. This page explains
          how to delete your Clickefy account and the personal data associated with it.
        </p>

        <div className="mt-10 space-y-10">
          <section>
            <h2 className="text-lg font-semibold">
              Option 1 — Delete it yourself in the mobile app (fastest)
            </h2>
            <ol className="mt-4 space-y-3">
              <Step n={1}>Open the Clickefy app.</Step>
              <Step n={2}>
                Go to <strong>Profile</strong>.
              </Step>
              <Step n={3}>
                Tap <strong>Account → Delete account</strong>.
              </Step>
              <Step n={4}>Confirm. Your account is scheduled for deletion immediately.</Step>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Option 2 — Delete it on the web</h2>
            <ol className="mt-4 space-y-3">
              <Step n={1}>
                Sign in at{" "}
                <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
                  app.clickefy.ai/settings
                </Link>
                .
              </Step>
              <Step n={2}>
                Scroll to <strong>Delete account</strong> and confirm.
              </Step>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Option 3 — Request deletion by email</h2>
            <p className="mt-3 text-[15px] leading-7 text-foreground/85">
              If you no longer have the app installed or can&rsquo;t sign in, email{" "}
              <a
                href={`mailto:${CONTACT}?subject=Delete%20my%20account`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {CONTACT}
              </a>{" "}
              from the email address on your Clickefy account with the subject{" "}
              <strong>&ldquo;Delete my account&rdquo;</strong>. We verify ownership of the address
              and process the request. We respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">What gets deleted</h2>
            <ul className="mt-3 list-disc space-y-2 ps-5 text-[15px] leading-7 text-foreground/85">
              <li>Your account and profile (email, display name, avatar).</li>
              <li>Photos and videos you uploaded as inputs.</li>
              <li>Your generation history and generated outputs.</li>
              <li>Your remaining credit balance.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold">What we keep, and for how long</h2>
            <ul className="mt-3 list-disc space-y-2 ps-5 text-[15px] leading-7 text-foreground/85">
              <li>
                Personal data is <strong>anonymised immediately</strong> on deletion.
              </li>
              <li>
                Uploaded files and generated outputs are purged from active systems{" "}
                <strong>within 30 days</strong>, and from backups <strong>within 90 days</strong>.
              </li>
              <li>Anonymised, aggregate analytics that can no longer identify you may be retained.</li>
              <li>
                Records we are legally required to keep (e.g. tax/transaction records) and
                safety/moderation reports are retained only as long as the law requires
                (moderation reports up to 1 year).
              </li>
            </ul>
          </section>

          <section>
            <p className="text-[15px] leading-7 text-foreground/85">
              Questions about deletion or your data:{" "}
              <a
                href={`mailto:${CONTACT}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {CONTACT}
              </a>
              . See also our{" "}
              <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
