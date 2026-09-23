import { sharePercent } from "@/lib/admin/dashboard";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BreakdownItem = {
  id: string;
  name: string;
  composition: string | null;
  price: number;
  isActive: boolean;
  bookings: number;
  paidBookings: number;
  passesIssued: number;
  people: number;
  /** null when money is withheld from this payload. */
  revenue: number | null;
  currency: string;
};

/**
 * How bookings are spread across the pass categories.
 *
 * A distribution is always read against a total, so every row shows three things
 * together: the share bar, the count, and the share as a percentage. The bar is the
 * quick read, the numbers are the answer, and neither is hidden behind a hover.
 *
 * Categories nobody has booked are kept in the list with an empty bar. Omitting them
 * would make the chart easier to read and less true — and the organiser's question is
 * usually "why did nobody buy that one?".
 *
 * Money is withheld rather than zeroed when it is absent from the payload: the bar, the
 * counts and the shares still describe the shape of demand, which is exactly the part
 * that is not sensitive.
 */
export function PassBreakdownChart({
  items,
  includeRevenue,
  title = "Pass category distribution",
  description,
  withheldNote,
}: {
  items: readonly BreakdownItem[];
  includeRevenue: boolean;
  title?: string;
  description: string;
  withheldNote?: string;
}) {
  const totalBookings = items.reduce((sum, item) => sum + item.bookings, 0);
  const maxBookings = items.reduce((max, item) => Math.max(max, item.bookings), 0);

  return (
    <figure className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
      <figcaption className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="text-muted text-xs/5">{description}</p>
      </figcaption>

      {items.length === 0 ? (
        <p className="text-muted border-border/70 bg-background/40 rounded-xl border px-4 py-6 text-center text-sm/6">
          No pass categories are configured yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const share = sharePercent(item.bookings, totalBookings);
            const width = maxBookings > 0 ? Math.max(item.bookings > 0 ? 4 : 0, (item.bookings / maxBookings) * 100) : 0;

            return (
              <li key={item.id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="flex items-baseline gap-2 text-sm font-semibold tracking-tight">
                    {item.name}
                    {item.composition ? (
                      <span className="text-muted text-xs font-medium">{item.composition}</span>
                    ) : null}
                    {!item.isActive ? (
                      <span className="text-muted/80 text-[0.625rem] font-semibold tracking-widest uppercase">
                        Inactive
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted text-xs tabular-nums">
                    {item.bookings} {item.bookings === 1 ? "booking" : "bookings"} · {item.people}{" "}
                    {item.people === 1 ? "person" : "people"} · {share}%
                  </p>
                </div>

                <div className="border-border/50 bg-background/40 h-2.5 w-full overflow-hidden rounded-full border">
                  <span
                    aria-hidden="true"
                    style={{ width: `${width}%` }}
                    className={cn(
                      "block h-full rounded-full",
                      item.paidBookings > 0 ? "bg-gradient-to-r from-violet to-rani" : "bg-surface-raised",
                    )}
                  />
                </div>

                <p className="text-muted/80 flex flex-wrap gap-x-3 text-[0.6875rem]">
                  <span className="tabular-nums">{formatInr(item.price, item.currency)} each</span>
                  <span className="tabular-nums">{item.paidBookings} paid</span>
                  <span className="tabular-nums">{item.passesIssued} passes issued</span>
                  {includeRevenue ? (
                    <span className="text-marigold-soft tabular-nums">
                      {item.revenue === null ? "—" : `${formatInr(item.revenue, item.currency)} taken`}
                    </span>
                  ) : (
                    <span>{withheldNote ?? "Revenue not included"}</span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="sr-only">
        {items.map((item) => `${item.name}: ${item.bookings} bookings, ${item.people} people.`).join(" ")}
      </p>
    </figure>
  );
}
