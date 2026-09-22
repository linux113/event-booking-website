import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming Navratri and Dandiya events and book your passes.",
};

export default function EventsPage() {
  return (
    <Section>
      <Container className="flex flex-col gap-10">
        <SectionHeading
          eyebrow="Events"
          headingLevel="h1"
          title="Browse Navratri &amp; Dandiya events"
          description="Search, filters and event cards land in the next step, once events are read from the database."
        />

        <EmptyState
          title="Listings are not connected yet"
          description="This page is intentionally empty: event data will come from Supabase, and there is no seed data or mock data in this scaffold."
          action={
            <Button href="/" variant="secondary" size="sm">
              Back to home
            </Button>
          }
        />
      </Container>
    </Section>
  );
}
