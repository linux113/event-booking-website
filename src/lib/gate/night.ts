import { siteConfig } from "@/config/site";

/**
 * Which night the gate is working.
 *
 * A digital pass is valid for one calendar date, and "tonight" has to be decided by
 * a clock somewhere. Two rules keep that honest:
 *
 *   1. **The server decides, always.** The browser is never asked what today is and
 *      never sends a date: a phone with a wrong clock, or a hand-made request, could
 *      otherwise admit a pass for a different night. The client only ever sends the
 *      token it scanned.
 *   2. **The venue's clock decides, not the server's.** A gate in Jaipur running on
 *      a Vercel machine in UTC, at 1am local time, is still working *that* night —
 *      and an event that starts at 7pm must not be refused because UTC has already
 *      rolled over. Hence `siteConfig.timezone`.
 *
 * The date is assembled from `Intl` *parts* rather than from a formatted string:
 * ICU builds disagree about punctuation and ordering, and a night must not change
 * because of the runtime's locale data.
 */

const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: siteConfig.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today at the venue, as `YYYY-MM-DD` — the same plain-date shape Postgres stores
 * in `event_dates.event_date`, and the value every gate check compares against.
 */
export function gateNight(now: Date = new Date()): string {
  const parts: Record<string, string> = {};

  for (const part of datePartsFormatter.formatToParts(now)) {
    parts[part.type] = part.value;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}
