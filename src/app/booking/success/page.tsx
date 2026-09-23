import type { Metadata, Route } from "next";
import type { ReactNode } from "react";

import { CalendarIcon, CheckIcon, ClockIcon, ShieldCheckIcon, UsersIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { PassList } from "@/components/pass/pass-list";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import { whatsappChatUrl, whatsappMessage } from "@/lib/contact";
import { getBookingPasses } from "@/lib/services/passes";
import { getSiteContact } from "@/lib/services/contact";
import { getBookingStatusByToken } from "@/lib/services/payments";

export const metadata: Metadata = {
  // Neutral on purpose: this page is also the landing spot for a booking whose
  // payment is still unverified, and a browser tab that says "Payment successful"
  // above "waiting for your payment" would be lying in the one place the customer
  // is most likely to look. The state is stated in the page body, from the database.
  title: "Booking confirmation",
  description: "Your booking, its passes and the QR code for each one.",
  // Personal to the customer who paid: never indexed.
  robots: { index: false, follow: false },
};

// Always the live row: this page is what a customer reloads (or keeps open) while a
// payment settles, and it must never show a cached "pending".
export const dynamic = "force-dynamic";

type BookingSuccessPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

/**
 * Where the browser lands once the payment has been verified — /booking/success?token=<public token>.
 *
 * Read-only, on purpose. Everything shown here — the booking reference, the
 * payment status, the issued passes — is fetched from the database on every
 * request, and nothing on this page can create a booking, an order or a pass. That
 * is what makes refreshing safe: the tenth reload of this URL reports the same one
 * booking with the same passes, because the passes were issued by
 * `confirm_booking_payment()` at the moment the payment was verified, not by this
 * page being opened.
 *
 * The token is the booking's random uuid, so the link is shareable with the people
 * who are coming without exposing a guessable booking reference, and the lookup
 * itself returns no mobile number or email address.
 */
export default async function BookingSuccessPage({ searchParams }: BookingSuccessPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) {
    return (
      <Fallback>
        <EmptyState
          title="No booking in this link"
          description="Open the confirmation link you were given after paying, or start a new booking."
          action={
            <Button href="/book" size="sm">
              Start a booking
            </Button>
          }
        />
      </Fallback>
    );
  }

  // One round trip each, in parallel: the booking's state, its passes, and the event's
  // contact details (which every WhatsApp link on the site is built from).
  const [bookingResult, passesResult, contact] = await Promise.all([
    getBookingStatusByToken(token),
    getBookingPasses(token),
    getSiteContact(),
  ]);

  if (!bookingResult.ok) {
    if (bookingResult.error.kind === "not-configured" || bookingResult.error.kind === "server-error") {
      return (
        <Fallback>
          <ErrorState
            error={{
              kind: bookingResult.error.kind === "not-configured" ? "not-configured" : "query-failed",
              message: bookingResult.error.message,
            }}
            title="Booking confirmation is unavailable"
          />
        </Fallback>
      );
    }

    return (
      <Fallback>
        <EmptyState
          title="We could not find that booking"
          description="The link may be incomplete or from a different site. Check the link from your confirmation, or start a new booking."
          action={
            <Button href="/book" size="sm">
              Start a booking
            </Button>
          }
        />
      </Fallback>
    );
  }

  const booking = bookingResult.booking;
  // A paid booking with an unreadable pass list still gets confirmed here; only the
  // pass buttons would be missing, and the status page re-reads them anyway.
  const passes = passesResult.ok ? passesResult.data : [];

  const isPaid = booking.status === "confirmed" && booking.paymentStatus === "paid";
  const isRefunded = booking.status === "refunded" || booking.paymentStatus === "refunded";
  const hasFailed = booking.paymentStatus === "failed";
  const timeRange = formatTimeRange(booking.startTime, booking.endTime);
  const statusHref = `/book/status?token=${encodeURIComponent(token)}` as Route;

  const facts: Array<{ label: string; value: string; icon?: "calendar" | "clock" | "users" }> = [
    { label: "Booking ID", value: booking.reference },
    {
      label: "Event date",
      value: `${formatEventDate(booking.eventDate)}${timeRange ? ` · ${timeRange}` : ""}`,
      icon: "calendar",
    },
    {
      label: "Pass category",
      value: `${booking.passName}${booking.passComposition ? ` — ${booking.passComposition}` : ""}`,
    },
    {
      label: "Passes",
      value: `${booking.quantity} ${booking.quantity === 1 ? "pass" : "passes"} · admits ${booking.numberOfPeople} ${
        booking.numberOfPeople === 1 ? "person" : "people"
      }`,
      icon: "users",
    },
    { label: isPaid ? "Amount paid" : "Amount due", value: formatInr(booking.totalAmount, booking.currency) },
  ];

  return (
    <>
      <PageHero
        eyebrow="Booking"
        title={isPaid ? "Payment successful" : isRefunded ? "This booking was refunded" : hasFailed ? "That payment did not complete" : "Waiting for your payment"}
        description={
          isPaid ? (
            <>
              We verified your payment of {formatInr(booking.totalAmount, booking.currency)} with Razorpay, so
              booking <strong className="font-semibold">{booking.reference}</strong> is confirmed and your digital
              passes are issued. Reload this page as often as you like — it always shows the same booking.
            </>
          ) : (
            <>
              Booking <strong className="font-semibold">{booking.reference}</strong> is recorded, but no verified
              payment has reached us yet. Nothing else has been charged.
            </>
          )
        }
      >
        <div className="flex flex-wrap gap-3">
          {isPaid && passes.length > 0 ? (
            <Button href={passes[0].passPath as Route} size="lg" className="w-full sm:w-auto">
              Digital pass
            </Button>
          ) : (
            <Button href="/book" size="lg" className="w-full sm:w-auto">
              {isPaid ? "Book another night" : "Complete the payment"}
            </Button>
          )}

          <Button href={statusHref} variant="secondary" size="lg" className="w-full sm:w-auto">
            Booking status
          </Button>
        </div>
      </PageHero>

      <Section className="pt-0">
        <Container className="flex max-w-3xl flex-col gap-6">
          {isPaid ? (
            <p className="border-peacock/40 bg-peacock/5 text-peacock-soft flex items-start gap-3 rounded-2xl border p-5 text-sm/6 font-medium">
              <CheckIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                {passes.length > 0
                  ? `${passes.length} ${passes.length === 1 ? "pass has" : "passes have"} been issued against this booking. Open a pass to show its QR code at the gate.`
                  : "Your payment is confirmed. The passes are being issued — reload this page in a moment to see them."}
              </span>
            </p>
          ) : isRefunded ? (
            <p className="border-rani/40 bg-rani/10 text-rani-soft flex items-start gap-3 rounded-2xl border p-5 text-sm/6 font-medium">
              <ShieldCheckIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                The payment was refunded, so this booking and its passes are no longer valid at the gate. Nothing
                else is owed.
              </span>
            </p>
          ) : (
            <p className="border-marigold/40 bg-marigold/8 text-marigold-soft flex items-start gap-3 rounded-2xl border p-5 text-sm/6 font-medium">
              <ClockIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                {hasFailed
                  ? "The payment was declined or cancelled, so this booking is still unpaid. Nothing has been charged — you can try again."
                  : "If you have just finished paying, give it a few seconds and reload this page: our server confirms the payment with Razorpay, and only then issues the passes."}
              </span>
            </p>
          )}

          <dl className="border-border bg-surface/50 divide-border/60 grid divide-y rounded-2xl border sm:grid-cols-2 sm:divide-y-0">
            {facts.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-0.5 p-5">
                <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
                  {fact.label}
                </dt>
                <dd className="flex items-center gap-2 font-semibold">
                  {fact.icon === "calendar" ? (
                    <CalendarIcon className="text-marigold size-4 shrink-0" aria-hidden="true" />
                  ) : null}
                  {fact.icon === "users" ? (
                    <UsersIcon className="text-marigold size-4 shrink-0" aria-hidden="true" />
                  ) : null}
                  <span>{fact.value}</span>
                </dd>
              </div>
            ))}
          </dl>

          {passes.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                {passes.length === 1 ? "Your digital pass" : `Your ${passes.length} digital passes`}
              </h2>
              <PassList passes={passes} />
              <p className="text-muted/80 text-xs">
                Every pass has its own QR code. One code admits one guest, so send each guest their own pass — the
                QR contains only a private code for that pass, never a name or phone number.
              </p>
            </div>
          ) : null}

          <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-5">
            <h2 className="text-sm font-semibold tracking-tight">What happens next</h2>
            <ul className="text-muted flex flex-col gap-2.5 text-sm/6">
              <li className="flex items-start gap-2.5">
                <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Bring the QR code and a photo ID for the lead guest. Staff scan each pass once at the entrance.
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Keep the booking link: it always shows the live status of this booking, on any device.
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Need to change something? Message the organiser with booking {booking.reference}.
              </li>
            </ul>

            <div className="flex flex-wrap gap-3 pt-1">
              <WhatsAppButton
                href={whatsappChatUrl(contact.whatsappNumber, whatsappMessage(booking.reference))}
                variant="full"
                size="sm"
              />
              <Button href="/contact" variant="secondary" size="sm">
                Other ways to reach us
              </Button>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}

function Fallback({ children }: { children: ReactNode }) {
  return (
    <Section>
      <Container className="max-w-2xl">{children}</Container>
    </Section>
  );
}
