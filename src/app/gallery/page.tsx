import type { Metadata } from "next";

import { GalleryTile } from "@/components/events/gallery-tile";
import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { listPublishedGallery } from "@/lib/services/gallery";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Photos, aerial drone footage and video highlights from our Navratri and Dandiya nights.",
};

// Gallery items are published in batches after each night.
export const revalidate = 300;

export default async function GalleryPage() {
  const result = await listPublishedGallery();

  if (!result.ok) {
    return (
      <Section>
        <Container>
          <ErrorState error={result.error} title="The gallery is unavailable" />
        </Container>
      </Section>
    );
  }

  const items = result.data;
  const [feature, ...rest] = items;
  const albums = Array.from(new Set(items.map((item) => item.tag)));

  return (
    <>
      <PageHero
        eyebrow="Gallery"
        title="Moments from the dance floor"
        description="Every photo and video on this page is published by the organiser from the event gallery. Nothing is stock imagery."
      />

      <Section className="pt-0">
        <Container className="flex flex-col gap-6">
          {items.length === 0 ? (
            <>
              <EmptyState
                title="No media published yet"
                description="Photos and drone footage are uploaded after each night and published here once the organiser approves them. Until then this page stays honestly empty."
                action={
                  <Button href="/contact" variant="secondary" size="sm">
                    Ask about the event
                  </Button>
                }
              />

              <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-6">
                <SectionHeading
                  headingLevel="h2"
                  title="What will appear here"
                  description="Each night gets an album containing photographs, the drone reel and any edited video highlights."
                  className="gap-2"
                />
                <ul className="text-muted flex flex-col gap-2 text-sm/6">
                  <li>
                    <span aria-hidden="true" className="text-marigold mr-2">
                      •
                    </span>
                    Photographs tagged by night and album
                  </li>
                  <li>
                    <span aria-hidden="true" className="text-marigold mr-2">
                      •
                    </span>
                    Drone and stage footage
                  </li>
                  <li>
                    <span aria-hidden="true" className="text-marigold mr-2">
                      •
                    </span>
                    Video highlights with an accessible description for every item
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                {feature ? <GalleryTile item={feature} size="feature" priority /> : null}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {rest.map((item) => (
                    <GalleryTile key={item.id} item={item} />
                  ))}
                </div>
              </div>

              <p className="text-muted/80 text-xs">
                {items.length} {items.length === 1 ? "item" : "items"} published
                {albums.length > 0 ? ` across ${albums.length} albums` : ""}.
              </p>
            </>
          )}
        </Container>
      </Section>

      {albums.length > 0 ? (
        <Section className="pt-0">
          <Container className="flex flex-col gap-8">
            <SectionHeading
              eyebrow="Albums"
              title="Albums by night"
              description="Media is grouped into albums so you can find your night quickly."
            />
            <ul className="flex flex-wrap gap-2">
              {albums.map((album) => (
                <li key={album}>
                  <span className="border-border bg-surface/60 text-muted inline-flex rounded-full border px-3.5 py-1.5 text-xs font-semibold">
                    {album}
                  </span>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      ) : null}

      <CtaBand
        title="Be in next year's gallery"
        description="Book a pass for this season and dance your way into the highlights reel."
      />
    </>
  );
}
