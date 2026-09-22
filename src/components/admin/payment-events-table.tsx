import Link from "next/link";
import type { Route } from "next";

import { StatusPill, type StatusTone } from "@/components/admin/status-pill";
import { outcomeLabel, outcomeTone, paiseToRupees } from "@/lib/admin/operations";
import type { PaymentEventRow } from "@/lib/services/admin-operations";
import { formatInr, formatTimestamp } from "@/lib/format";

/**
 * The delivery log: what the gateway sent, and what the site did about it.
 *
 * This is the screen's evidence table, and it is arranged as one, not as a list of
 * bookings: event type, the outcome the site recorded, the gateway's own amount, when it
 * arrived and when it was processed, and then — where one can be identified — the
 * booking it belongs to. A delivery that matches no booking is *shown*, not hidden: "a
 * payment arrived that we cannot place" is precisely the thing an operator needs to see.
 *
 * On a phone the table collapses to the three things that matter when somebody is
 * reading it out loud: what happened, the outcome, and which booking.
 */
export function PaymentEventsTable({
  rows,
  includeContact,
}: {
  rows: readonly PaymentEventRow[];
  includeContact: boolean;
}) {
  return (
    <div className="border-border bg-surface/50 overflow-hidden rounded-2xl border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Razorpay deliveries and checkout confirmations, newest first, with the outcome the site recorded and the
            booking each one belongs to.
          </caption>
          <thead>
            <tr className="text-muted/80 bg-surface-raised/40 text-[0.6875rem] font-semibold tracking-widest uppercase">
              <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                Event
              </th>
              <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                Outcome
              </th>
              {includeContact ? (
                <th scope="col" className="border-border/60 border-b px-4 py-2.5 text-right">
                  Amount
                </th>
              ) : null}
              <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                Received
              </th>
              <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 md:table-cell">
                Processed
              </th>
              <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                Gateway ids
              </th>
              <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 lg:table-cell">
                Booking
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.event_uuid} className="border-border/60 border-b last:border-b-0">
                <td className="px-4 py-3 align-top">
                  <span className="font-mono text-xs font-semibold">{row.event_type}</span>
                  <p className="text-muted mt-0.5 font-mono text-[0.6875rem] break-all">{row.event_id}</p>
                </td>

                <td className="px-4 py-3 align-top">
                  <StatusPill label={outcomeLabel(row.outcome)} tone={outcomeTone(row.outcome) as StatusTone} />
                </td>

                {includeContact ? (
                  <td className="px-4 py-3 text-right align-top">
                    <span className="text-sm font-semibold whitespace-nowrap">
                      {row.amount_paise === null ? "—" : formatInr(paiseToRupees(row.amount_paise) ?? 0, row.currency ?? undefined)}
                    </span>
                  </td>
                ) : null}

                <td className="text-muted px-4 py-3 align-top text-xs whitespace-nowrap">
                  {formatTimestamp(row.received_at)}
                </td>

                <td className="text-muted hidden px-4 py-3 align-top text-xs whitespace-nowrap md:table-cell">
                  {row.processed_at ? formatTimestamp(row.processed_at) : "—"}
                </td>

                <td className="px-4 py-3 align-top">
                  <p className="font-mono text-[0.6875rem] break-all">{row.razorpay_order_id ?? "—"}</p>
                  <p className="text-muted font-mono text-[0.6875rem] break-all">{row.razorpay_payment_id ?? "—"}</p>
                </td>

                <td className="hidden px-4 py-3 align-top lg:table-cell">
                  {row.booking_id ? (
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`/admin/bookings/${encodeURIComponent(row.booking_id)}` as Route}
                        className="focus-visible:ring-marigold/40 font-mono text-xs font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {row.booking_id}
                      </Link>
                      <span className="text-muted text-[0.6875rem]">{row.customer_name}</span>
                      <span className="text-muted text-[0.6875rem]">
                        {[row.payment_status, row.booking_status].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted text-xs">
                      No booking holds this id — the delivery is recorded, and belongs to nothing we can place.
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
