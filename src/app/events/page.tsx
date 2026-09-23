import type { Metadata } from "next";

import { NightList } from "@/components/events/night-list";
import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { buildSiteContact } from "@/lib/contact";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatDateRange } from "@/lib/format";
import { getFeaturedEventBundle, listPublishedEvents } from "@/lib/services/events";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming Navratri and Dandiya events and book your passes.",
};

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const [list, bundle] = await Promise.all([listPublishedEvents(), getFeaturedEventBundle()]);

  if (!list.ok) {
    return (
      <Section>
        <Container>
          <ErrorState error={list.error} title="Events are unavailable" />
        </Container>
      </Section>
    );
  }

  const events = list.data;
  const featured = bundle.ok ? bundle.data : null;

  return (
    <>
      <PageHero
        eyebrow="Events"
        title="Browse Navratri & Dandiya events"
        description="Events are read from the database. Search and city filters arrive once more than one event is published."
      />

      <Section className="pt-0">
        <Container className="flex flex-col gap-10">
          {events.length === 0 ? (
            <EmptyState
              title="No events published yet"
              description="As soon as an event is published in the database, it appears here with its nights and passes."
              action={
                <Button href="/" variant="secondary" size="sm">
                  Back to home
                </Button>
              }
            />
          ) : (
            <>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {events.map((event) => (
                  <li key={event.id}>
                    <article className="border-border bg-surface/60 flex h-full flex-col gap-3 rounded-2xl border p-6">
                      <h2 className="text-lg font-semibold tracking-tight">{event.name}</h2>
                      {event.tagline ? (
                        <p className="text-marigold-soft text-sm font-semibold">{event.tagline}</p>
                      ) : null}
                      <p className="text-muted text-sm/6">
                        {[event.venueName, event.city, event.state].filter(Boolean).join(", ")}
                      </p>
                      <div className="mt-auto flex gap-3 pt-2">
                        <Button href="/passes" size="sm">
                          View passes
                        </Button>
                        <Button href="/book" variant="secondary" size="sm">
                          Book now
                        </Button>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>

              {featured && featured.nights.length > 0 ? (
                <div className="flex flex-col gap-6">
                  <SectionHeading
                    eyebrow="Nights"
                    title={`Nights at ${featured.event.name}`}
                    description={`${formatDateRange(featured.nights.map((night) => night.date))} · ${featured.event.venueName}, ${featured.event.city}`}
                  />
                  <NightList nights={featured.nights} />
                </div>
              ) : null}
            </>
          )}
        </Container>
      </Section>

      <CtaBand contact={buildSiteContact(featured?.event)} />
    </>
  );
}
