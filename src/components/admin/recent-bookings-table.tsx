import { StatusPill, statusTone } from "@/components/admin/status-pill";
import { formatEventDate, formatInr, formatTimestamp } from "@/lib/format";
import type { RecentBooking } from "@/lib/services/admin";

/**
 * The newest bookings, as a table.
 *
 * One rendering path, three widths:
 *
 *   * on a phone the table keeps only the columns that identify a booking (reference,
 *     guest, status) and moves the night under the guest's name, because a horizontally
 *     scrolling table on a phone in a dark hall is a table nobody reads;
 *   * on a tablet the night and the pass come back;
 *   * on a desktop everything is visible at once.
 *
 * When the caller omits contact columns (legacy `includeContact=false` path), mobile and amount
 * are already null — the columns are not rendered at all for that role rather than
 * rendered as empty, and the note under the table says so in words. Nothing here
 * decides what may be shown; it only draws what it was given.
 */
export function RecentBookingsTable({
  rows,
  includeContact,
  currency,
  limit,
}: {
  rows: readonly RecentBooking[];
  includeContact: boolean;
  currency: string;
  limit: number;
}) {
  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">Recent bookings</h3>
          <p className="text-muted text-xs/5">
            The last {limit} bookings placed, newest first, with the night and pass each one holds.
          </p>
        </div>
        <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-wider uppercase">
          {rows.length} of {limit}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted border-border/70 bg-background/40 rounded-xl border px-4 py-8 text-center text-sm/6">
          No bookings yet. The first one will appear here the moment it is placed.
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <caption className="sr-only">Recent bookings, newest first</caption>
            <thead>
              <tr className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
                <th scope="col" className="border-border/60 border-b py-2 pr-3">
                  Reference
                </th>
                <th scope="col" className="border-border/60 border-b py-2 pr-3">
                  Guest
                </th>
                <th scope="col" className="border-border/60 hidden border-b py-2 pr-3 md:table-cell">
                  Night
                </th>
                <th scope="col" className="border-border/60 hidden border-b py-2 pr-3 md:table-cell">
                  Pass
                </th>
                <th scope="col" className="border-border/60 hidden border-b py-2 pr-3 text-right sm:table-cell">
                  People
                </th>
                {includeContact ? (
                  <th scope="col" className="border-border/60 border-b py-2 pr-3 text-right">
                    Amount
                  </th>
                ) : null}
                <th scope="col" className="border-border/60 border-b py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.booking_uuid} className="border-border/40 border-b last:border-b-0">
                  <th scope="row" className="py-3 pr-3 align-top font-mono text-xs font-semibold">
                    {row.booking_id}
                  </th>
                  <td className="py-3 pr-3 align-top">
                    <span className="font-semibold tracking-tight">{row.customer_name}</span>
                    {includeContact && row.customer_mobile ? (
                      <span className="text-muted mt-0.5 block text-xs">
                        {row.customer_mobile}
                      </span>
                    ) : null}
                    {/* On a phone the night lives here, where there is room for it. */}
                    <span className="text-muted mt-0.5 block text-xs md:hidden">
                      {formatEventDate(row.event_date)} · {row.pass_name}
                      {includeContact && row.total_amount !== null
                        ? ` · ${formatInr(row.total_amount, currency)}`
                        : ""}
                    </span>
                    <span className="text-muted/70 mt-0.5 block text-[0.6875rem]">
                      {formatTimestamp(row.created_at)}
                    </span>
                  </td>
                  <td className="hidden py-3 pr-3 align-top text-xs md:table-cell">
                    {formatEventDate(row.event_date)}
                  </td>
                  <td className="hidden py-3 pr-3 align-top text-xs md:table-cell">
                    {row.pass_name}
                    <span className="text-muted/70 block">× {row.quantity}</span>
                  </td>
                  <td className="hidden py-3 pr-3 text-right align-top tabular-nums sm:table-cell">
                    {row.number_of_people}
                  </td>
                  {includeContact ? (
                    <td className="py-3 pr-3 text-right align-top font-semibold tabular-nums">
                      {row.total_amount === null ? "—" : formatInr(row.total_amount, currency)}
                    </td>
                  ) : null}
                  <td className="py-3 align-top">
                    <span className="flex flex-wrap gap-1.5">
                      <StatusPill label={row.booking_status} tone={statusTone(row.booking_status)} />
                      <StatusPill label={row.payment_status} tone={statusTone(row.payment_status)} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!includeContact ? (
        <p className="text-muted/80 text-xs/5">
          Contact details and amounts are not included — the table asks the database for bookings without
          them, so they are not on this page at all, not merely out of view.
        </p>
      ) : null}
    </section>
  );
}
