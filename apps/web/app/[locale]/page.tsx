import type { Metadata } from "next";
import { Navbar } from "@/components/site/navbar";
import { HomeHero } from "@/components/site/home-hero";
import { ModelRow } from "@/components/site/model-row";
import { VideoBanner } from "@/components/site/video-banner";
import { TemplatesSection } from "@/components/site/templates-section";
import { PricingSection } from "@/components/site/pricing-section";
import { Footer } from "@/components/site/footer";
import { localizedPageMetadata } from "@/lib/page-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return localizedPageMetadata(locale, "");
}

export default function Home() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
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
