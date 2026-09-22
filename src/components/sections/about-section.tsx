import Image from "next/image";

import aboutImage from "@/assets/images/about-dandiya.jpg";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import type { EventHighlight, EventSummary } from "@/types";

type AboutSectionProps = {
  event: EventSummary;
  highlights: readonly EventHighlight[];
};

/**
 * About block. Copy comes from the `events` row and its `event_highlights`;
 * the accompanying artwork is a bundled brand illustration (not event data).
 */
export function AboutSection({ event, highlights }: AboutSectionProps) {
  const location = [event.venueName, event.venueAddress, event.city, event.state]
    .filter(Boolean)
    .join(", ");

  return (
    <Section id="about">
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="relative order-2 lg:order-1">
          <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/40">
            <Image
              src={aboutImage}
              alt="Flat lay of decorated dandiya sticks, a lit clay diya and marigold petals on indigo silk"
              fill
              sizes="(max-width: 1024px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
        </div>

        <div className="order-1 flex flex-col gap-6 lg:order-2">
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
