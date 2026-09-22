import type { Metadata } from "next";

import { BookingConfirmation } from "@/components/booking/booking-confirmation";
import { PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getBookingPasses } from "@/lib/services/passes";
import { getBookingStatusByToken } from "@/lib/services/payments";

export const metadata: Metadata = {
  title: "Booking status",
  description: "Live status of a booking, including whether the payment has been verified.",
  // A status link is personal to the customer who paid: never indexed.
  robots: { index: false, follow: false },
};

// The status must be what the database says right now, on every refresh.
export const dynamic = "force-dynamic";

type BookingStatusPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

/**
 * Server-rendered booking status, reachable at /book/status?token=<public token>.
 *
 * This is why the payment step survives a refresh: the confirmation is a URL, not
 * client state. Razorpay Checkout hands the browser back to this page after a
 * verified payment, the webhook can confirm the booking afterwards, and the page
 * simply reads the current row again on every request.
 *
 * The token is a random uuid from the booking row — not the booking reference and
 * not the mobile number — so a guessed URL cannot reveal personal details, and the
 * lookup itself returns none.
 */
export default async function BookingStatusPage({ searchParams }: BookingStatusPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) {
    return (
      <Section>
        <Container>
          <EmptyState
            title="No booking in this link"
            description="Open the confirmation link you were given after payment, or start a new booking."
            action={
              <Button href="/book" size="sm">
                Start a booking
              </Button>
            }
          />
        </Container>
      </Section>
    );
  }

  const [result, passesResult] = await Promise.all([getBookingStatusByToken(token), getBookingPasses(token)]);

  if (!result.ok) {
    if (result.error.kind === "server-error" || result.error.kind === "not-configured") {
      return (
        <Section>
          <Container>
            <ErrorState
              error={{
                kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
                message: result.error.message,
              }}
              title="Booking status is unavailable"
            />
          </Container>
        </Section>
      );
    }

    return (
      <Section>
        <Container>
          <EmptyState
            title="We could not find that booking"
            description="The link may be incomplete or from a different site. Check the link from your confirmation, or start a new booking."
            action={
              <Button href="/book" size="sm">
                Start a booking
              </Button>
            }
          />
        </Container>
      </Section>
    );
  }

  const booking = result.booking;
  // Passes are a second read, and only ever a read: a booking that has none (unpaid,
  // or refunded before issue) simply shows no pass buttons.
  const passes = passesResult.ok ? passesResult.data : [];

  return (
    <>
      <PageHero
        eyebrow="Booking status"
        title={booking.status === "confirmed" ? "Your booking is confirmed" : "Your booking"}
        description="This page always shows the live row from the database — refresh it any time, on any device."
      />

      <Section className="pt-0">
        <Container className="max-w-3xl">
          <BookingConfirmation booking={booking} passes={passes} />
        </Container>
      </Section>
    </>
  );
}
