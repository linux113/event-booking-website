import type { Metadata } from "next";
import Image from "next/image";

import { CheckIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { buildSiteContact } from "@/lib/contact";
import { FeatureStrip } from "@/components/sections/feature-strip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatDateRange } from "@/lib/format";
import { getFeaturedEventBundle } from "@/lib/services/events";
import { listPublishedGallery } from "@/lib/services/gallery";

export const metadata: Metadata = {
  title: "About",
  description:
    "About our Navratri and Dandiya festival — the venue, the production, the safety arrangements and what a night looks like.",
};

export const revalidate = 300;

/** The default About Us checklist, shown until the organiser saves their own. */
const DEFAULT_ORGANISATION_POINTS = [
  "Marshalled dance floor with a dedicated family zone",
  "Medical desk and trained floor staff on every night",
  "Digital QR entry passes with capacity checks at the gate",
] as const;

/** The default About Us paragraphs, shown until the organiser saves their own. */
const DEFAULT_ABOUT_BODY =
  "Live dhol and garba raas rounds early in the evening, dandiya circles after that, and a DJ set to close. Traditional garba does not need a partner; dandiya rounds are organised by the floor marshals so nobody is left standing at the edge.";

export default async function AboutPage() {
  const [result, gallery] = await Promise.all([getFeaturedEventBundle(), listPublishedGallery()]);

  if (!result.ok) {
    return (
      <Section>
        <Container>
          <ErrorState error={result.error} title="Event details are unavailable" />
        </Container>
      </Section>
    );
  }

  const bundle = result.data;

  if (!bundle) {
    return (
      <Section>
        <Container>
          <EmptyState
            title="No event published yet"
            description="This page describes the festival once an event is published in the database."
          />
        </Container>
      </Section>
    );
  }

  const { event, highlights, features, nights, content } = bundle;
  const dateRange = formatDateRange(nights.map((night) => night.date));
  const venue = [event.venueName, event.venueAddress, event.city, event.state]
    .filter(Boolean)
    .join(", ");

  // Organiser-edited About Us copy; blank fields fall back to the defaults.
  const aboutTitle =
    content.aboutTitle ??
    `${nights.length} ${nights.length === 1 ? "night" : "nights"} of garba, dandiya and live music`;
  const aboutBody = content.aboutBody ?? DEFAULT_ABOUT_BODY;
  const organisationPoints = content.aboutPoints.length > 0 ? content.aboutPoints : DEFAULT_ORGANISATION_POINTS;

  // The event's own imagery — the administrable hero image, then the latest
  // published gallery photo; no bundled picture is used any more.
  const fallbackPhoto = gallery.ok ? gallery.data[0] : null;
  const image =
    event.heroImageUrl !== null
      ? { src: event.heroImageUrl, alt: `${event.name} at ${event.venueName}` }
      : fallbackPhoto
        ? { src: fallbackPhoto.src, alt: fallbackPhoto.alt }
        : null;

  return (
    <>
      <PageHero
        eyebrow="About"
        title={event.tagline ?? event.name}
        description={event.description}
      >
        {dateRange ? (
          <p className="text-muted text-sm">
            {dateRange} · {venue}
          </p>
        ) : null}
      </PageHero>

      <Section className="pt-0">
        <Container className={`grid items-start gap-12 ${image ? "lg:grid-cols-2 lg:gap-16" : ""}`}>
          <div className="flex flex-col gap-6">
            <SectionHeading title={aboutTitle} description={aboutBody} />

            <div className="flex flex-col gap-2">
              <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
                Venue
              </p>
              <p className="text-sm/6">{venue}</p>
              {event.mapsUrl ? (
                <a
                  href={event.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-marigold-soft hover:text-marigold w-fit text-sm font-semibold underline-offset-4 hover:underline"
                >
                  Open in Google Maps
                </a>
              ) : null}
            </div>

            <ul className="flex flex-col gap-3">
              {organisationPoints.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm/6">
                  <span className="bg-peacock/15 text-peacock mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                    <CheckIcon className="size-3.5" />
                  </span>
                  <span className="text-muted">{point}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button href="/book">Book Now</Button>
              <Button href="/passes" variant="secondary">
                See pass options
              </Button>
            </div>
          </div>

          {image ? (
            <div className="flex flex-col gap-4">
              <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/40">
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  unoptimized
                  sizes="(max-width: 1024px) 100vw, 45vw"
                  className="object-cover"
                />
              </div>
              <Button href="/book" size="lg" className="w-full">
                Book Now
              </Button>
            </div>
          ) : null}
        </Container>
      </Section>

      <FeatureStrip features={features} />

      {highlights.length > 0 ? (
        <Section className="pt-0">
          <Container className="flex flex-col gap-10">
            <SectionHeading
              eyebrow="Highlights"
              title="What to expect on the night"
              description="Highlights are attached to the event record, so each event can advertise its own programme."
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {highlights.map((highlight) => (
                <Card key={highlight.id} className="flex flex-col gap-2 p-5">
                  <h3 className="text-base font-semibold tracking-tight">{highlight.title}</h3>
                  {highlight.description ? (
                    <p className="text-muted text-sm/6">{highlight.description}</p>
                  ) : null}
                </Card>
              ))}
            </div>
          </Container>
        </Section>
      ) : null}

      <CtaBand
        title="Come for one night or all nine"
        description="Passes are per night. Compare the pass options and pick what suits your group."
        contact={buildSiteContact(event)}
      />
    </>
  );
}
