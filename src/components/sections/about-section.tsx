import Image from "next/image";

import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatInr } from "@/lib/format";
import type { EventHighlight, EventSummary, GalleryItem, PassOption } from "@/types";

type AboutSectionProps = {
  event: EventSummary;
  highlights: readonly EventHighlight[];
  passes: readonly PassOption[];
  /** First published gallery item, used as artwork when the event has no uploaded image. */
  fallbackImage: GalleryItem | null;
};

/**
 * About block. Copy comes from the `events` row and its `event_highlights`;
 * the artwork is the event's own uploaded image (hero image, otherwise the
 * latest published gallery photo) — no bundled stock picture — with a Book
 * Now action directly beneath it.
 */
export function AboutSection({ event, highlights, passes, fallbackImage }: AboutSectionProps) {
  const location = [event.venueName, event.venueAddress, event.city, event.state]
    .filter(Boolean)
    .join(", ");

  const image = resolveAboutImage(event, fallbackImage);
  const bookablePasses = passes.filter((pass) => pass.availability.enabled);
  const cheapest = bookablePasses.length ? Math.min(...bookablePasses.map((pass) => pass.priceInr)) : null;

  return (
    <Section id="about">
      <Container className={`grid items-center gap-12 ${image ? "lg:grid-cols-2 lg:gap-16" : ""}`}>
        {image ? (
          <div className="relative order-2 flex flex-col gap-4 lg:order-1">
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

            {/* Book Now directly under the artwork. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              {cheapest !== null ? (
                <p className="text-muted text-sm">
                  Passes from{" "}
                  <span className="text-marigold-soft font-semibold">{formatInr(cheapest, event.currency)}</span>{" "}
                  per pass
                </p>
              ) : null}
              <Button href="/book" size="lg" className="w-full sm:w-auto sm:shrink-0">
                Book Now
              </Button>
            </div>
          </div>
        ) : null}

        <div className={`order-1 flex flex-col gap-6 ${image ? "lg:order-2" : ""}`}>
          <SectionHeading
            eyebrow="About the event"
            title={event.tagline ?? `About ${event.name}`}
            description={event.description}
          />

          <div className="flex flex-col gap-3">
            <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
              Venue
            </p>
            <p className="text-sm/6">{location}</p>
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

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button href="/about" variant="secondary">
              More about us
            </Button>
            {!image ? <Button href="/book">Book Now</Button> : null}
            <Button href="/passes" variant="ghost" className="justify-start">
              See pass options
            </Button>
          </div>
        </div>
      </Container>

      {highlights.length > 0 ? (
        <Container className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((highlight) => (
            <div
              key={highlight.id}
              className="border-border bg-surface/50 hover:border-violet-soft/40 rounded-2xl border p-5 transition-colors duration-200"
            >
              <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <CheckIcon className="text-peacock size-4 shrink-0" />
                {highlight.title}
              </h3>
              {highlight.description ? (
                <p className="text-muted mt-2 text-sm/6">{highlight.description}</p>
              ) : null}
            </div>
          ))}
        </Container>
      ) : null}
    </Section>
  );
}

/**
 * The event's own imagery only: the administrable hero image first, then the
 * latest published gallery photo. Nothing bundled — when the organiser has
 * published no image at all, the section simply renders its text.
 */
function resolveAboutImage(
  event: EventSummary,
  fallbackImage: GalleryItem | null,
): { src: string; alt: string } | null {
  if (event.heroImageUrl) {
    return { src: event.heroImageUrl, alt: `${event.name} at ${event.venueName}` };
  }

  if (fallbackImage) {
    return { src: fallbackImage.src, alt: fallbackImage.alt };
  }

  return null;
}
