import type { Metadata } from "next";

import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoEvent } from "@/config/event";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming Navratri and Dandiya events and book your passes.",
};

/**
 * Database-backed listing route. It stays empty until the `events` table exists —
 * the single event shown across the rest of the site is demo content, so it is not
 * presented here as a searchable catalogue.
 */
export default function EventsPage() {
  return (
    <>
      <PageHero
        eyebrow="Events"
        title="Browse Navratri & Dandiya events"
        description="Search, city filters and event cards land once events are read from the database. Nothing is listed here yet because the catalogue does not exist."
      />

      <Section className="pt-0">
        <Container className="flex flex-col gap-10">
          <EmptyState
            title="No events published yet"
            description="Event cards, city filters and per-night availability appear here after the Supabase events table is connected. There is no seed or mock catalogue in this build."
            action={
              <Button href="/" variant="secondary" size="sm">
                Back to home
              </Button>
            }
          />

          <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-6">
            <SectionHeading
              headingLevel="h2"
              title="Currently featured event"
              description={`${demoEvent.name} — ${demoEvent.dates} at ${demoEvent.venue}, ${demoEvent.location}. This is demo content shown on the home page, not a live listing.`}
              className="gap-2"
            />
            <div className="flex flex-wrap gap-3 pt-1">
              <Button href="/passes" size="sm">
                View passes
              </Button>
              <Button href="/book" variant="secondary" size="sm">
                Book now
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <CtaBand />
    </>
  );
}
