import { Navbar } from "@/components/site/navbar";
import { HomeHero } from "@/components/site/home-hero";
import { ModelRow } from "@/components/site/model-row";
import { VideoBanner } from "@/components/site/video-banner";
import { TemplatesSection } from "@/components/site/templates-section";
import { PricingSection } from "@/components/site/pricing-section";
import { Footer } from "@/components/site/footer";

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
