import type { Metadata } from "next";

import { NightSelector } from "@/components/booking/night-selector";
import { PassCard } from "@/components/events/pass-card";
import { CalendarIcon, CheckIcon, MapPinIcon, SparkleIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatDateRange, formatTimeRange } from "@/lib/format";
import { getFeaturedEventBundle } from "@/lib/services/events";

export const metadata: Metadata = {
  title: "Book Now",
  description:
    "Choose your night and passes for the Navratri and Dandiya festival. Online checkout opens with Razorpay in the next build step.",
};

// Availability must be current on every request.
export const dynamic = "force-dynamic";

const WHAT_YOU_NEED = [
  "A mobile number that can receive the booking confirmation",
  "A UPI app, card or netbanking account for the Razorpay checkout",
  "One lead name per pass group for the entry register",
  "Photo ID for the lead guest, checked at the gate",
] as const;

export default async function BookPage() {
  const result = await getFeaturedEventBundle();

  if (!result.ok) {
    return (
      <Section>
        <Container>
          <ErrorState error={result.error} title="Booking information is unavailable" />
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
            title="Nothing to book yet"
            description="No event is published in the database, so there are no nights or passes to choose from."
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

  const { event, nights, passes } = bundle;
  const bookableNights = nights.filter((night) => night.isBookable);
  const bookablePasses = passes.filter((pass) => pass.availability.enabled);
  const firstNight = nights[0];
  const timeRange = firstNight ? formatTimeRange(firstNight.startTime, firstNight.endTime) : null;

  return (
    <>
      <PageHero
        eyebrow="Book now"
        title="Reserve your pass"
        description="Pick your night and pass below. Checkout is not live yet — this page collects nothing and takes no payment until Razorpay is wired up in the next step."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="/passes" size="lg" className="w-full sm:w-auto">
            View Passes
          </Button>
          <WhatsAppButton
            variant="full"
            size="lg"
            className="w-full sm:w-auto"
            message="Hi! I'd like help booking passes for the Navratri event."
          />
        </div>
      </PageHero>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <div className="border-marigold/40 bg-marigold/8 flex flex-col gap-3 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <SparkleIcon className="text-marigold size-5" />
              Checkout is not open yet
            </h2>
            <p className="text-muted text-sm/7">
              Choosing a night and a pass below does not reserve anything: the booking and payment
              steps arrive with Razorpay. For group or corporate bookings, message the organiser on
              WhatsApp and availability will be confirmed manually.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <WhatsAppButton
                variant="full"
                size="sm"
                number={event.contactPhone?.replace(/[^0-9]/g, "")}
                message="Hi! I'd like to book a group pass for the Navratri event."
              />
              <Button href="/contact" variant="secondary" size="sm">
                Other ways to reach us
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
          <div className="border-border bg-surface/50 flex flex-col gap-5 rounded-2xl border p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Available nights</h2>
              <p className="text-muted text-sm/6">
                {bookableNights.length} of {nights.length} nights can be booked right now. Fully
                booked and cancelled nights are shown but cannot be selected.
              </p>
            </div>

            <NightSelector nights={nights} />
          </div>

          <div className="flex flex-col gap-6">
            <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
              <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
                <CalendarIcon className="text-marigold size-5" />
                Event details
              </h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Detail label="Event" value={event.name} />
                <Detail label="Dates" value={formatDateRange(nights.map((n) => n.date)) || "—"} />
                <Detail label="Timing" value={timeRange ?? "—"} />
                <Detail label="Venue" value={event.venueName} />
                <Detail label="Location" value={[event.city, event.state].filter(Boolean).join(", ")} />
              </dl>
              {event.mapsUrl ? (
                <a
                  href={event.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-marigold-soft hover:text-marigold flex w-fit items-center gap-1.5 text-sm font-semibold"
                >
                  <MapPinIcon className="size-4" />
                  Get directions
                </a>
              ) : null}
            </div>

            <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
              <h2 className="text-lg font-semibold tracking-tight">What you will need</h2>
              <ul className="flex flex-col gap-2.5">
                {WHAT_YOU_NEED.map((item) => (
                  <li key={item} className="text-muted flex items-start gap-2.5 text-sm/6">
                    <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-muted/80 border-border/70 border-t pt-4 text-xs">
                Refunds, transfers and cancellations are governed by the organiser&apos;s policy,
                which will be published here alongside the checkout.
              </p>
            </div>
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="Choose a pass"
            title="Passes on sale"
            description={
              bookablePasses.length === passes.length
                ? "Every pass type is currently on sale."
                : `${bookablePasses.length} of ${passes.length} pass types are on sale. Disabled passes cannot be booked.`
            }
          />

          {passes.length > 0 ? (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {passes.map((pass) => (
                <li key={pass.id} className="h-full">
                  <PassCard pass={pass} variant="preview" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No passes on sale"
              description="This event has no pass categories yet."
            />
          )}
        </Container>
      </Section>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
