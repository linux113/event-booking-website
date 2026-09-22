import { AboutSection } from "@/components/sections/about-section";
import { ContactSection } from "@/components/sections/contact-section";
import { CtaBand } from "@/components/sections/cta-band";
import { FeatureStrip } from "@/components/sections/feature-strip";
import { GalleryPreview } from "@/components/sections/gallery-preview";
import { Hero } from "@/components/sections/hero";
import { PassesPreview } from "@/components/sections/passes-preview";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { getFeaturedEventBundle } from "@/lib/services/events";
import { listPublishedGallery } from "@/lib/services/gallery";
import type { ServiceError } from "@/lib/services/result";
import type { EventBundle, GalleryItem } from "@/types";

// Content changes only when an organiser publishes something; a short ISR window
// keeps the page fast without serving stale data for long.
export const revalidate = 300;

type HomeData =
  | { ok: true; bundle: EventBundle | null; gallery: GalleryItem[] }
  | { ok: false; error: ServiceError };

async function loadHomeData(): Promise<HomeData> {
  const [bundle, gallery] = await Promise.all([getFeaturedEventBundle(), listPublishedGallery()]);

  if (!bundle.ok) {
    return { ok: false, error: bundle.error };
  }

  if (!gallery.ok) {
    return { ok: false, error: gallery.error };
  }

  return { ok: true, bundle: bundle.data, gallery: gallery.data };
}

export default async function HomePage() {
  const result = await loadHomeData();

  if (!result.ok) {
    return (
      <Section>
        <Container>
          <ErrorState error={result.error} title="We could not load the event" />
        </Container>
      </Section>
    );
  }

  const { bundle } = result;

  // The database is reachable but has no published event yet.
  if (!bundle) {
    return (
      <>
        <Section className="pt-16">
          <Container className="flex flex-col gap-8">
            <SectionHeading
              eyebrow="Navratri season"
              headingLevel="h1"
              title="No event is published yet"
              description="This site is connected to the database, but no event has been published. Create one in the events table and it appears here immediately."
            />
            <EmptyState
              title="Nothing published right now"
              description="Events, nights, passes and gallery items are all read from the database — nothing on this site is hard-coded."
              action={
                <Button href="/contact" variant="secondary" size="sm">
                  Contact the organiser
                </Button>
              }
            />
          </Container>
        </Section>
        <CtaBand />
      </>
    );
  }

  return (
    <>
      <Hero bundle={bundle} />
      <FeatureStrip features={bundle.features} />
      <AboutSection event={bundle.event} highlights={bundle.highlights} />
      <PassesPreview passes={bundle.passes} />
      <GalleryPreview items={result.gallery} />
      <ContactSection variant="preview" event={bundle.event} />
      <CtaBand />
    </>
  );
}
