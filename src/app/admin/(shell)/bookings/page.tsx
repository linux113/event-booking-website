import type { Metadata } from "next";
import Link from "next/link";

import { BookingFilters } from "@/components/admin/booking-filters";
import { BookingPager } from "@/components/admin/bookings-pager";
import { BookingsTable } from "@/components/admin/bookings-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  EXPORT_MAX_ROWS,
  isFiltered,
  isInvertedDateRange,
  pageSummary,
  parseBookingQuery,
  type SearchParamsInput,
} from "@/lib/admin/bookings";
import { requirePermission } from "@/lib/auth/guard";
import { listBookingPassOptions, listBookings } from "@/lib/services/admin";

export const metadata: Metadata = {
  title: "Bookings",
  description: "Search, filter and export every booking for the event.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type BookingsPageProps = {
  searchParams: Promise<SearchParamsInput>;
};

/**
 * Booking management — the list.
 *
 * The search box, the five filters, the paging and the CSV export all run through one
 * database function (`admin_search_bookings`), so what is on screen, what the next
 * page shows and what the export contains are the same rows by construction rather
 * than by three implementations agreeing.
 *
 * What changes with the role is the *shape of the answer*, not the layout of the page.
 * A staff member's request goes to the database with `p_include_contact = false`, so
 * mobile numbers, email addresses, amounts and gateway ids are never returned to this
 * process at all — there is nothing here to leak and nothing to remember to hide. The
 * panel says so in words rather than leaving empty columns to be wondered about.
 */
export default async function BookingsPage({ searchParams }: BookingsPageProps) {
  const staff = await requirePermission("bookings:view");
  const query = parseBookingQuery(await searchParams);

  // Two independent reads, so one round trip's worth of latency for the page: the
  // results, and the pass categories the filter bar offers.
  const [list, passOptions] = await Promise.all([listBookings(query, staff.role), listBookingPassOptions()]);

  if (!list.ok) {
    return (
      <ErrorState
        error={{
          kind: list.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: list.error.message,
        }}
        title="Booking management is unavailable"
      />
    );
  }

  const page = list.data;
  const summary = pageSummary(page.page, page.pageSize, page.total);
  const filtering = isFiltered(query);
  const inverted = isInvertedDateRange(query);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bookings</h1>
        <p className="text-muted text-sm/6">
          Every booking for the event, newest first. Search by anything a guest can quote — reference, name, mobile,
          email, pass ID or a Razorpay ID — and narrow with the filters.
          {page.includeContact
            ? " You can see contact details and amounts for every booking."
            : " Contact details and amounts are hidden for your role; ask an admin if you need them."}
        </p>
      </div>

      <BookingFilters
        query={query}
        passOptions={passOptions.ok ? passOptions.data : []}
        exportable={page.total > 0}
        total={page.total}
        includeContact={page.includeContact}
      />

      {inverted ? (
        <p className="border-marigold/40 bg-marigold/5 text-marigold-soft rounded-2xl border px-4 py-3 text-sm/6">
          The night range ends before it starts, so nothing can match it. Swap the two dates to search that period.
        </p>
      ) : null}

      {page.rows.length === 0 ? (
        filtering ? (
          <EmptyState
            title="No bookings match these filters"
            description={
              <>
                Nothing in the list matches the current search and filters.{" "}
                <Link href="/admin/bookings" className="text-marigold-soft font-semibold hover:underline">
                  Clear them
                </Link>{" "}
                to see every booking.
              </>
            }
          />
        ) : (
          <EmptyState
            title="No bookings yet"
            description="The first booking will appear here the moment a guest completes checkout on the public site."
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-muted text-xs">{summary ?? `${page.rows.length} bookings`}</p>
            <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-wider uppercase">
              Page {page.page} of {Math.max(1, Math.ceil(page.total / page.pageSize))}
            </p>
          </div>

          <BookingsTable rows={page.rows} includeContact={page.includeContact} query={query} />

          <BookingPager query={query} total={page.total} page={page.page} pageSize={page.pageSize} />
        </>
      )}

      <p className="text-muted/70 text-xs/5">
        The CSV export contains the rows matching the current filters, in the same order as this list, up to{" "}
        {EXPORT_MAX_ROWS.toLocaleString("en-IN")} rows per download. Narrow the filters for anything larger.
      </p>
    </>
  );
}
