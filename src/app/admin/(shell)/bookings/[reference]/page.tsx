import type { Metadata, Route } from "next";
import Link from "next/link";

import { BookingDetailPanel } from "@/components/admin/booking-detail-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { backToBookingsHref, parseBookingQueryString, type SearchParamsInput } from "@/lib/admin/bookings";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { getBookingDetail } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

type BookingDetailPageProps = {
  params: Promise<{ reference: string }>;
  searchParams: Promise<SearchParamsInput>;
};

export async function generateMetadata({ params }: BookingDetailPageProps): Promise<Metadata> {
  const { reference } = await params;

  return {
    // The reference identifies the booking in a browser tab full of them; the page
    // itself is never indexed.
    title: `Booking ${reference}`,
    description: "One booking in full: the guest, the night, the payment and the passes.",
    robots: { index: false, follow: false },
  };
}

/**
 * One booking, in full — the detail view for /admin/bookings.
 *
 * A page rather than a modal, on purpose. An operator dealing with a guest on the phone
 * needs a URL they can send to a colleague, a view they can reload, and a screen that
 * survives the browser's back button; a modal gives none of those. The list links here
 * with its filters in the `back` parameter, so returning to the list returns to the
 * same page of the same search.
 *
 * The lookup accepts anything an operator can be given — a booking reference, a pass
 * ID, a Razorpay payment ID or an order ID — because those are the four things that
 * appear in the messages guests and support threads actually contain. `admin_booking_detail`
 * resolving them is also what keeps the pass's QR token out of the response entirely.
 */
export default async function BookingDetailPage({ params, searchParams }: BookingDetailPageProps) {
  const staff = await requirePermission("bookings:view");
  const [{ reference }, query] = await Promise.all([params, searchParams]);
  // The list's filters, carried through the row link. Parsed with the same rules as the
  // list itself, so a hand-written `back` can only ever produce a valid search.
  const back = parseBookingQueryString(query.back);

  // `reference` arrives URL-decoded from the router; it is passed on as-is so a
  // reference containing a `%` is never decoded twice.
  const result = await getBookingDetail(reference, staff.role);

  if (!result.ok) {
    return (
      <ErrorState
        error={{
          kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: result.error.message,
        }}
        title="That booking could not be loaded"
      />
    );
  }

  const booking = result.data;

  if (!booking) {
    return (
      <>
        <BackLink href={backToBookingsHref(back) as Route} />
        <EmptyState
          title="No booking with that identifier"
          description={`Nothing matches “${reference}”. A booking reference looks like DND202600001, a pass ID like PS-000123, and a Razorpay ID starts with pay_ or order_. Check the value, or search the list by the guest's name.`}
          action={
            <Link
              href={backToBookingsHref(back) as Route}
              className="bg-marigold text-marigold-foreground hover:bg-marigold-soft inline-flex h-10 items-center justify-center rounded-full px-5 text-sm font-semibold tracking-tight transition-colors"
            >
              Back to bookings
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <BackLink href={backToBookingsHref(back) as Route} />

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Booking {booking.reference}</h1>
        <p className="text-muted text-sm/6">
          Everything recorded for this booking: the guest and their contact details, the night and pass they hold, the
          payment the gateway verified, and every pass and gate entry raised from it.
        </p>
      </div>

      <BookingDetailPanel booking={booking} includeContact={can(staff.role, "bookings:view_contact")} />
    </>
  );
}

/** The way back to the list, filters and page intact. */
function BackLink({ href }: { href: Route }) {
  return (
    <Link
      href={href}
      className="text-muted hover:text-foreground focus-visible:ring-marigold/40 inline-flex w-fit items-center gap-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span aria-hidden="true">←</span> Back to bookings
    </Link>
  );
}
