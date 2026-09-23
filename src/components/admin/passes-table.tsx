import Link from "next/link";
import type { Route } from "next";

import { StatusPill, statusTone } from "@/components/admin/status-pill";
import { passState } from "@/lib/admin/operations";
import { formatEventDate, formatInr, formatTimeRange, formatTimestamp } from "@/lib/format";
import type { PassListRow } from "@/lib/services/admin-operations";

/**
 * The pass list, as a table.
 *
 * The columns are the ones somebody at a door needs, in the order they use them: the
 * pass itself (number, slot, state), the guest, the night, and the entry — when it
 * happened, at which gate, by whom. On a phone the table narrows to the pass and the
 * guest; on a tablet the night and the entry come back; on a desktop everything is
 * visible at once.
 *
 * Two things are deliberately absent. The **QR token** — a list of live credentials on a
 * shared tablet is the opposite of what a token is for, and `admin_pass_list` does not
 * return it, so this component has nothing to forget to hide. And any **control** that
 * could cancel or re-admit a pass: admitting is done by scanning, and cancelling happens
 * when a refund does, which is a gateway event. A screen that could do either by hand
 * would be a screen that can be talked into admitting somebody.
 */
export function PassTable({
  rows,
  includeContact,
}: {
  rows: readonly PassListRow[];
  includeContact: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="border-border bg-surface/50 overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Every issued pass matching the filters, newest first, with the booking it belongs to and its entry
              record.
            </caption>
            <thead>
              <tr className="text-muted/80 bg-surface-raised/40 text-[0.6875rem] font-semibold tracking-widest uppercase">
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Pass
                </th>
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Guest
                </th>
                {includeContact ? (
                  <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 lg:table-cell">
                    Mobile
                  </th>
                ) : null}
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Night
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 md:table-cell">
                  Pass category
                </th>
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Entry
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 xl:table-cell">
                  Issued
                </th>
                {includeContact ? (
                  <th scope="col" className="border-border/60 border-b px-4 py-2.5 text-right">
                    Amount
                  </th>
                ) : null}
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  <span className="sr-only">Booking</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.pass_uuid} className="border-border/60 border-b last:border-b-0">
                  <td className="px-4 py-3 align-top">
                    <p className="font-mono text-xs font-semibold">{row.pass_id}</p>
                    <p className="text-muted mt-0.5 text-[0.6875rem]">
                      {row.pass_number} of {row.passes_on_booking}
                    </p>
                    <p className="mt-1">
                      <StatusPill label={row.pass_status} tone={statusTone(row.pass_status)} />
                    </p>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <p className="font-medium tracking-tight">{row.customer_name}</p>
                    <Link
                      href={`/admin/bookings/${encodeURIComponent(row.booking_id)}` as Route}
                      className="text-muted focus-visible:ring-marigold/40 mt-0.5 inline-block font-mono text-[0.6875rem] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {row.booking_id}
                    </Link>
                    <p className="text-muted/80 mt-0.5 text-[0.6875rem] lg:hidden">
                      {[row.customer_mobile, `${row.booking_status} · ${row.payment_status}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </td>

                  {includeContact ? (
                    <td className="hidden px-4 py-3 align-top lg:table-cell">
                      <span className="text-xs">{row.customer_mobile ?? "—"}</span>
                      <p className="text-muted/80 mt-0.5 text-[0.6875rem]">
                        {row.booking_status} · {row.payment_status}
                      </p>
                    </td>
                  ) : null}

                  <td className="px-4 py-3 align-top">
                    <p className="text-xs whitespace-nowrap">{formatEventDate(row.valid_date)}</p>
                    <p className="text-muted mt-0.5 text-[0.6875rem] whitespace-nowrap">
                      {formatTimeRange(row.start_time, row.end_time) ?? row.event_name}
                    </p>
                  </td>

                  <td className="hidden px-4 py-3 align-top md:table-cell">
                    <p className="text-xs">{row.pass_name}</p>
                    <p className="text-muted mt-0.5 text-[0.6875rem]">
                      {row.number_of_people} {row.number_of_people === 1 ? "person" : "people"}
                    </p>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <p className="text-xs font-medium whitespace-nowrap">
                      {passState({ passStatus: row.pass_status, checkedIn: row.checked_in })}
                    </p>
                    {row.checked_in_at ? (
                      <p className="text-muted mt-0.5 text-[0.6875rem] whitespace-nowrap">
                        {formatTimestamp(row.checked_in_at)}
                      </p>
                    ) : null}
                    {row.gate || row.admitted_by ? (
                      <p className="text-muted mt-0.5 text-[0.6875rem]">
                        {[row.gate, row.admitted_by ? `by ${row.admitted_by}` : null].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </td>

                  <td className="text-muted hidden px-4 py-3 align-top text-xs whitespace-nowrap xl:table-cell">
                    {formatTimestamp(row.issued_at)}
                  </td>

                  {includeContact ? (
                    <td className="px-4 py-3 text-right align-top">
                      <span className="text-xs font-semibold whitespace-nowrap">
                        {row.total_amount === null ? "—" : formatInr(row.total_amount, row.currency)}
                      </span>
                    </td>
                  ) : null}

                  <td className="px-4 py-3 text-right align-top">
                    <Link
                      href={`/admin/bookings/${encodeURIComponent(row.booking_id)}` as Route}
                      className="text-marigold-soft focus-visible:ring-marigold/40 text-xs font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      Booking
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!includeContact ? (
        <p className="text-muted/80 text-xs/5">
          Guest contact details and amounts are not shown for your role. Everything you need at a door — the pass, the
          guest, the night and the entry — is here.
        </p>
      ) : null}
    </div>
  );
}
