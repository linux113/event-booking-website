import Link from "next/link";
import type { Route } from "next";

import { StatusPill, statusTone } from "@/components/admin/status-pill";
import { bookingQueryToSearchParams, checkInSummary, type BookingQuery, type BookingRow } from "@/lib/admin/bookings";
import { formatEventDate, formatInr, formatTimeRange, formatTimestamp } from "@/lib/format";

/**
 * The booking list itself.
 *
 * Every column the operations team asked for is here — booking ID, customer, mobile,
 * date, pass, amount, payment status, booking status, created at, check-in
 * status — but not every column is drawn at every width. A phone shows the identity of
 * the booking, its night, and where it stands; the table widens as the screen does and
 * a desktop shows all of it at once. The hidden columns are still in the markup, so the
 * page a screen reader or a test sees is the same page at every width.
 *
 * Contact columns are not rendered when they are absent from the payload: rows arrive with
 * `customerMobile` and `totalAmount` already null, and the table asks `includeContact`
 * before drawing the header, so
 * there is no empty column implying withheld data. The note underneath says, in words,
 * why the columns are absent.
 */
export function BookingsTable({
  rows,
  includeContact,
  query,
}: {
  rows: readonly BookingRow[];
  includeContact: boolean;
  query: BookingQuery;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="border-border bg-surface/50 overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Bookings matching the current search and filters, newest first. Each row links to the booking in full.
            </caption>
            <thead>
              <tr className="text-muted/80 bg-surface-raised/40 text-[0.6875rem] font-semibold tracking-widest uppercase">
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Booking ID
                </th>
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Customer
                </th>
                {includeContact ? (
                  <>
                    <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 lg:table-cell">
                      Mobile
                    </th>
                  </>
                ) : null}
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Date
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 md:table-cell">
                  Pass
                </th>
                {includeContact ? (
                  <th scope="col" className="border-border/60 border-b px-4 py-2.5 text-right">
                    Amount
                  </th>
                ) : null}
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Payment
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 sm:table-cell">
                  Booking
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 xl:table-cell">
                  Created
                </th>
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Check-in
                </th>
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.bookingUuid} row={row} includeContact={includeContact} query={query} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!includeContact ? (
        <p className="text-muted/80 text-xs/5">
          Contact details, amounts and Razorpay IDs are not shown here. Everything you need to find a guest
          and admit them — their name, night, pass and check-in state — is here. Ask an admin if you need the rest.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  row,
  includeContact,
  query,
}: {
  row: BookingRow;
  includeContact: boolean;
  query: BookingQuery;
}) {
  // The list an operator returns to is the list they left. The reference identifies the
  // booking; `back` carries the current filters (and page) so the detail page can offer
  // "back to the list" onto the same page of the same search.
  const detailHref = `/admin/bookings/${encodeURIComponent(row.reference)}${
    bookingQueryToSearchParams(query) ? `?back=${encodeURIComponent(bookingQueryToSearchParams(query))}` : ""
  }`;

  return (
    <tr className="border-border/60 hover:bg-surface-raised/30 border-b transition-colors last:border-b-0">
      <td className="px-4 py-3 align-top">
        <Link
          href={detailHref as Route}
          className="focus-visible:ring-marigold/40 font-mono text-xs font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {row.reference}
        </Link>
        <p className="text-muted mt-1 text-[0.6875rem] xl:hidden">{formatTimestamp(row.createdAt)}</p>
      </td>

      <td className="px-4 py-3 align-top">
        <p className="font-medium tracking-tight">{row.customerName}</p>

        {includeContact ? (
          <p className="text-muted mt-0.5 text-xs xl:hidden">
            {row.customerMobile || "No mobile"}
          </p>
        ) : null}
      </td>

      {includeContact ? (
        <>
          <td className="hidden px-4 py-3 align-top lg:table-cell">
            <span className="text-xs">{row.customerMobile ?? "—"}</span>
          </td>
          <td className="hidden px-4 py-3 align-top xl:table-cell">
          </td>
        </>
      ) : null}

      <td className="px-4 py-3 align-top">
        <p className="whitespace-nowrap text-xs">{formatEventDate(row.eventDate)}</p>
        <p className="text-muted mt-0.5 text-[0.6875rem] whitespace-nowrap">
          {formatTimeRange(row.startTime, row.endTime) ?? row.eventName}
        </p>
      </td>

      <td className="hidden px-4 py-3 align-top md:table-cell">
        <p className="text-xs">
          {row.passName}
          <span className="text-muted"> × {row.quantity}</span>
        </p>
        <p className="text-muted mt-0.5 text-[0.6875rem]">
          {row.numberOfPeople} {row.numberOfPeople === 1 ? "person" : "people"}
          {row.passComposition ? ` · ${row.passComposition}` : ""}
        </p>
      </td>

      {includeContact ? (
        <td className="px-4 py-3 text-right align-top">
          <span className="font-semibold whitespace-nowrap">
            {row.totalAmount === null ? "—" : formatInr(row.totalAmount, row.currency)}
          </span>
        </td>
      ) : null}

      <td className="px-4 py-3 align-top">
        <StatusPill label={row.paymentStatus} tone={statusTone(row.paymentStatus)} />
        <p className="text-muted mt-1 text-[0.6875rem] sm:hidden">
          <StatusPill label={row.bookingStatus} tone={statusTone(row.bookingStatus)} />
        </p>
      </td>

      <td className="hidden px-4 py-3 align-top sm:table-cell">
        <StatusPill label={row.bookingStatus} tone={statusTone(row.bookingStatus)} />
      </td>

      <td className="hidden px-4 py-3 align-top xl:table-cell">
        <span className="text-muted text-xs whitespace-nowrap">{formatTimestamp(row.createdAt)}</span>
      </td>

      <td className="px-4 py-3 align-top">
        <span className="text-xs font-medium whitespace-nowrap">
          {checkInSummary({
            passesIssued: row.passesIssued,
            passesCheckedIn: row.passesCheckedIn,
            paymentStatus: row.paymentStatus,
          })}
        </span>
        {row.passIds.length > 0 ? (
          <p className="text-muted mt-0.5 font-mono text-[0.6875rem]">
            {row.passIds.length === 1 ? row.passIds[0] : `${row.passIds.length} passes`}
          </p>
        ) : null}
      </td>

      <td className="px-4 py-3 text-right align-top">
        <Link
          href={detailHref as Route}
          className="text-marigold-soft focus-visible:ring-marigold/40 text-xs font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          View
        </Link>
      </td>
    </tr>
  );
}
