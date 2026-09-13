import type { Metadata } from "next";
import { Navbar } from "@/components/site/navbar";
import { HomeHero } from "@/components/site/home-hero";
import { ModelRow } from "@/components/site/model-row";
import { VideoBanner } from "@/components/site/video-banner";
import { TemplatesSection } from "@/components/site/templates-section";
import { PricingSection } from "@/components/site/pricing-section";
import { Footer } from "@/components/site/footer";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { config } from "@/lib/config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return localizedPageMetadata(locale, "");
}

/**
 * Who publishes the site and what it is called, as structured data —
 * what search engines read for the site name and logo shown next to a
 * result. Rendered as a script tag in the page, per Next's JSON-LD guide.
 */
function siteJsonLd(locale: string) {
  const org = `${config.siteUrl}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": org,
        name: "Clickefy",
        url: config.siteUrl,
        logo: `${config.siteUrl}/icons/icon-512.png`,
        email: "support@clickefy.ai",
      },
      {
        "@type": "WebSite",
        "@id": `${config.siteUrl}/#website`,
        name: "Clickefy",
        url: config.siteUrl,
        inLanguage: locale,
        publisher: { "@id": org },
      },
    ],
  };
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <script
        type="application/ld+json"
        // `<` escaped so no string in the payload can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)).replace(/</g, "\\u003c") }}
      />
      <Navbar />
      <main className="py-4 sm:py-6">
        <HomeHero />
        <ModelRow />
        <VideoBanner />
        <div id="templates" className="scroll-mt-20">
          <TemplatesSection />
        </div>
        <div id="pricing" className="scroll-mt-20">
          <PricingSection />
        </div>
      </main>
      <Footer />
    </div>
  );
}
