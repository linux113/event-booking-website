import Link from "next/link";
import type { Route } from "next";

import { bookingsHref, pageWindow, type BookingQuery } from "@/lib/admin/bookings";

/**
 * Paging for the booking list.
 *
 * Link-based, so every page of every filtered search is a real URL that can be shared,
 * bookmarked or reloaded. The control shows at most five page numbers around the
 * current one plus the last page, because "1 2 3 … 84" is more useful than eighty-four
 * links, and the numbers that are drawn are drawn as links to their own `page` value
 * with the current filters preserved.
 *
 * Rendered only when there is more than one page; a single-page result set should not
 * spend a row of the screen telling the operator so.
 */
export function BookingPager({
  query,
  total,
  page,
  pageSize,
}: {
  query: BookingQuery;
  total: number;
  page: number;
  pageSize: number;
}) {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));

  if (pages <= 1) {
    return null;
  }

  const current = Math.min(Math.max(1, page), pages);
  const numbers = pageWindow(current, pages);
  const linkClass =
    "border-border text-muted hover:text-foreground hover:border-marigold/50 focus-visible:ring-marigold/40 inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none";

  return (
    <nav aria-label="Booking list pages" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted text-xs">
        Page {current} of {pages}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {current > 1 ? (
          <Link
            href={bookingsHref(query, { page: current - 1 }) as Route}
            rel="prev"
            className={linkClass}
            aria-label="Previous page"
          >
            Prev
          </Link>
        ) : null}

        {numbers[0] > 1 ? <span className="text-muted/60 px-1 text-sm">…</span> : null}

        {numbers.map((number) =>
          number === current ? (
            <span
              key={number}
              aria-current="page"
              className="border-marigold/50 bg-marigold/10 text-marigold-soft inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-semibold"
            >
              {number}
            </span>
          ) : (
            <Link
              key={number}
              href={bookingsHref(query, { page: number }) as Route}
              className={linkClass}
              aria-label={`Page ${number}`}
            >
              {number}
            </Link>
          ),
        )}

        {numbers[numbers.length - 1] < pages ? <span className="text-muted/60 px-1 text-sm">…</span> : null}

        {current < pages ? (
          <Link
            href={bookingsHref(query, { page: current + 1 }) as Route}
            rel="next"
            className={linkClass}
            aria-label="Next page"
          >
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
