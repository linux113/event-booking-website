import { AboutSection } from "@/components/sections/about-section";
import { ContactSection } from "@/components/sections/contact-section";
import { CtaBand } from "@/components/sections/cta-band";
import { FeatureStrip } from "@/components/sections/feature-strip";
import { GalleryPreview } from "@/components/sections/gallery-preview";
import { Hero } from "@/components/sections/hero";
import { PassesPreview } from "@/components/sections/passes-preview";

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeatureStrip />
      <AboutSection />
      <PassesPreview />
      <GalleryPreview />
      <ContactSection variant="preview" />
      <CtaBand />
    </>
  );
}
