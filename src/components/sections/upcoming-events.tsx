import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";

/**
 * Event listings will render here once the Supabase `events` table exists.
 * Until then this component renders an explicit empty state rather than
 * placeholder events, so the site never displays made-up inventory.
 */
export function UpcomingEvents() {
  return (
    <Section id="events" className="scroll-mt-20">
      <Container className="flex flex-col gap-10">
        <SectionHeading
          eyebrow="Upcoming"
          title="Events on the calendar"
          description="Every listing on this page will be read from the database — nothing here is hard-coded."
        />

        <EmptyState
          title="No events published yet"
          description="This is the project scaffold. As soon as the Supabase events table is connected and an organiser publishes a night, it will appear here with live availability."
          action={
            <Button href="/events" variant="secondary" size="sm">
              Open the events page
            </Button>
          }
        />
      </Container>
    </Section>
  );
}
