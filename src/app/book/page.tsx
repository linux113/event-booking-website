import type { Metadata } from "next";

import { BookingWizard } from "@/components/booking/booking-wizard";
import { CalendarIcon, CheckIcon, MapPinIcon, SparkleIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getPublicPaymentMode } from "@/config/env";
import { isPaymentGatewayUsable } from "@/lib/payments/razorpay";
import { formatDateRange, formatTimeRange } from "@/lib/format";
import { buildSiteContact, WHATSAPP_MESSAGE } from "@/lib/contact";
import { getFeaturedEventBundle } from "@/lib/services/events";

export const metadata: Metadata = {
  title: "Book Now",
  description:
    "Reserve passes for the Navratri and Dandiya festival in four steps: pick your date and time, choose your tickets, add your details and pay securely with Razorpay.",
};

// Availability must be current on every request.
export const dynamic = "force-dynamic";

const AFTER_CONFIRMING = [
  "A booking reference like DND202600001 is created against your details.",
  "Razorpay Checkout opens for the amount our server calculated — card and UPI details stay inside Razorpay's window.",
  "We verify the payment on our server and only then confirm the booking and issue your passes.",
] as const;

const AFTER_CONFIRMING_WITHOUT_PAYMENTS = [
  "A booking reference like DND202600001 is created against your details.",
  "The booking is held as pending and unpaid — nothing is charged on this site.",
  "The organiser completes the payment with you directly and issues your pass afterwards.",
] as const;

const WHAT_YOU_NEED = [
  "A mobile number that can receive the booking confirmation",
  "The lead guest's full name for the entry register",
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
  // The event's own contact details; the buttons below never carry a number of their own.
  const contact = buildSiteContact(event);
  // Online payment only becomes available once the server holds usable Razorpay
  // keys (a live key with live mode off does not count), and the key prefix decides
  // whether the site tells customers it is running in test mode.
  const paymentsReady = isPaymentGatewayUsable();
  const paymentMode = getPublicPaymentMode();
  const firstNight = nights[0];
  const timeRange = firstNight ? formatTimeRange(firstNight.startTime, firstNight.endTime) : null;

  return (
    <>
      <PageHero
        eyebrow="Book now"
        title="Reserve your pass"
        description="Four steps: date & time, tickets, your details, review. Availability and prices are read from the database, and the amount you pay is calculated on the server before Checkout opens."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="#checkout" size="lg" className="w-full sm:w-auto">
            Start booking
          </Button>
          <WhatsAppButton href={contact.whatsappHref} variant="full" size="lg" className="w-full sm:w-auto" />
        </div>
      </PageHero>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <div className="border-marigold/40 bg-marigold/8 flex flex-col gap-3 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <SparkleIcon className="text-marigold size-5" />
              {paymentsReady ? "Pay securely with Razorpay" : "Payment is handled by the organiser"}
            </h2>
            <p className="text-muted text-sm/7">
              {paymentsReady ? (
                <>
                  Confirming creates a real booking with a reference number and opens Razorpay Checkout for the
                  amount our server calculated. Your card or UPI details are entered in Razorpay&apos;s window,
                  never on this website, and the booking becomes{" "}
                  <strong className="font-semibold">confirmed</strong> only after the payment is verified on our
                  server. Until then it stays <strong className="font-semibold">pending</strong> and{" "}
                  <strong className="font-semibold">unpaid</strong>.
                  {paymentMode === "test" ? (
                    <>
                      {" "}
                      This deployment is running on <strong className="font-semibold">Razorpay test keys</strong>,
                      so no real money moves.
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  Online payment is not connected on this deployment yet: no Razorpay keys are configured, so
                  confirming only holds the booking as <strong className="font-semibold">pending</strong> and{" "}
                  <strong className="font-semibold">unpaid</strong>. Nothing is charged and no card or UPI
                  details are collected — the organiser takes payment directly.
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <WhatsAppButton href={contact.whatsappHref} variant="full" size="sm" />
              <p className="text-muted/80 text-xs/5">
                Opens WhatsApp with “{WHATSAPP_MESSAGE}” already typed.
              </p>
              <Button href="/contact" variant="secondary" size="sm">
                Other ways to reach us
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section className="pt-0" id="checkout">
        <Container className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
          <BookingWizard
            event={event}
            nights={nights}
            passes={passes}
            paymentsReady={paymentsReady}
            paymentMode={paymentMode}
          />

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
                {(paymentsReady ? AFTER_CONFIRMING : AFTER_CONFIRMING_WITHOUT_PAYMENTS).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
              <p className="text-muted/80 border-border/70 border-t pt-4 text-xs">
                Refunds, transfers and cancellations follow the organiser&apos;s policy. Message the organiser
                with your booking reference before the night you booked.
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
