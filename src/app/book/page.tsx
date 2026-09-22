import type { Metadata } from "next";

import { BookingWizard } from "@/components/booking/booking-wizard";
import { CalendarIcon, CheckIcon, MapPinIcon, SparkleIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { formatDateRange, formatTimeRange } from "@/lib/format";
import { getFeaturedEventBundle } from "@/lib/services/events";

export const metadata: Metadata = {
  title: "Book Now",
  description:
    "Reserve passes for the Navratri and Dandiya festival in four steps: choose your night, choose your pass, add your details and review. The booking is created as pending — no payment is collected yet.",
};

// Availability must be current on every request.
export const dynamic = "force-dynamic";

const AFTER_CONFIRMING = [
  "A booking reference like DND202600001 is created and shown on screen.",
  "The booking is stored as pending with payment not yet made — nothing is charged on this site.",
  "The organiser confirms your booking on WhatsApp, and your QR pass is issued once payment is received.",
] as const;

const WHAT_YOU_NEED = [
  "A mobile number that can receive the booking confirmation",
  "The lead guest's full name for the entry register",
  "One email address for the confirmation",
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
  const firstNight = nights[0];
  const timeRange = firstNight ? formatTimeRange(firstNight.startTime, firstNight.endTime) : null;

  return (
    <>
      <PageHero
        eyebrow="Book now"
        title="Reserve your pass"
        description="Four steps: night, pass, your details, review. Availability and prices are read from the database, and your total is calculated on the server when you confirm."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="#checkout" size="lg" className="w-full sm:w-auto">
            Start booking
          </Button>
          <WhatsAppButton
            variant="full"
            size="lg"
            className="w-full sm:w-auto"
            number={event.contactPhone?.replace(/[^0-9]/g, "")}
            message="Hi! I'd like help booking passes for the Navratri event."
          />
        </div>
      </PageHero>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <div className="border-marigold/40 bg-marigold/8 flex flex-col gap-3 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <SparkleIcon className="text-marigold size-5" />
              No payment is taken here yet
            </h2>
            <p className="text-muted text-sm/7">
              Confirming creates a real booking with a reference number, stored as{" "}
              <strong className="font-semibold">pending</strong> and{" "}
              <strong className="font-semibold">not paid</strong>. Online payment (Razorpay) arrives in
              the next step — until then nothing is charged, and no card or UPI details are collected on
              this website.
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

      <Section className="pt-0" id="checkout">
        <Container className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
          <BookingWizard event={event} nights={nights} passes={passes} />

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
            </div>

            <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
              <h2 className="text-lg font-semibold tracking-tight">After you confirm</h2>
              <ol className="text-muted flex list-decimal flex-col gap-2.5 pl-5 text-sm/6">
                {AFTER_CONFIRMING.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
              <p className="text-muted/80 border-border/70 border-t pt-4 text-xs">
                Refunds, transfers and cancellations follow the organiser&apos;s policy, which will be
                published here alongside the checkout.
              </p>
            </div>
          </div>
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
