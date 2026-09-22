import type { Metadata } from "next";

import { GalleryTile } from "@/components/events/gallery-tile";
import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { PromoVideos } from "@/components/sections/promo-videos";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoGallery } from "@/config/gallery";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Photos, aerial drone footage and video highlights from our Navratri and Dandiya nights.",
};

export default function GalleryPage() {
  const [feature, ...rest] = demoGallery;

  return (
    <>
      <PageHero
        eyebrow="Gallery"
        title="Moments from the dance floor"
        description="Original artwork stands in for event photography until the first night is shot. Photos and drone footage will be uploaded to storage and listed here."
      />

      <Section className="pt-0">
        <Container className="flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            {feature ? <GalleryTile item={feature} size="feature" priority /> : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {rest.map((item) => (
                <GalleryTile key={item.id} item={item} />
              ))}
            </div>
          </div>

          <DemoBadge label="Placeholder artwork — real photographs come after the event" className="w-fit" />
        </Container>
      </Section>

      <PromoVideos />

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="Albums"
            title="Photo albums by night"
            description="Each festival night will get its own album, published once photographers have delivered the edited set."
          />

          <EmptyState
            title="No albums published yet"
            description="Albums are created from the database and link to their photos in storage. Nothing is on display until real photos exist."
          />
        </Container>
      </Section>

      <CtaBand
        title="Be in next year's gallery"
        description="Book a pass for this season and dance your way into the highlights reel."
      />
    </>
  );
}
