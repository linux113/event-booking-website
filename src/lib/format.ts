import { siteConfig } from "@/config/site";

/**
 * Formatting helpers.
 *
 * Dates and times come out of Postgres as plain strings (`2026-10-11`,
 * `19:00:00`) with no timezone. They are formatted by parsing the parts
 * ourselves and always formatting in UTC, which guarantees a night never shifts
 * by a day regardless of the server's or the visitor's timezone.
 *
 * The date strings are assembled from `Intl.DateTimeFormat` *parts* rather than
 * from `format()` output: ICU builds disagree about punctuation (`Sun, 11 Oct
 * 2026` vs `Sun, 11 Oct, 2026`), and a price or a date must not change because
 * of the runtime's ICU version. The locale still supplies the words and the
 * order-independent pieces; the separators are ours.
 */

const eventDateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const longDateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Compact enough for a chart axis: `11 Oct`. */
const shortDateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * Parse a Postgres `date` into a UTC-anchored Date (never shifts the calendar
 * day).
 *
 * Accepts `YYYY-MM-DD`, and also a full ISO timestamp such as
 * `2026-10-11T00:00:00.000Z` — a `date` column should never arrive as a
 * timestamp, but if a driver or a future column hands us one, the calendar day
 * is taken as written instead of the raw value leaking into the page.
 * Returns null for anything unparseable, so callers can fall back deliberately.
 */
function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value ?? "");

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function formatParts(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  const parts: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return parts;
}

/** `2026-10-11T00:00:00.000Z` and `2026-10-11` sort as the same night. */
function compareDates(left: { value: string; date: Date | null }, right: { value: string; date: Date | null }): number {
  if (left.date && right.date) {
    return left.date.getTime() - right.date.getTime();
  }

  return left.value.localeCompare(right.value);
}

/** `2026-10-11` → `Sun, 11 Oct 2026`. Falls back to the raw value if unparseable. */
export function formatEventDate(isoDate: string): string {
  const date = parseDate(isoDate);

  if (!date) {
    return isoDate;
  }

  const parts = formatParts(eventDateFormatter, date);

  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
}

/** `2026-10-11` → `11 October 2026`. */
export function formatLongDate(isoDate: string): string {
  const date = parseDate(isoDate);

  if (!date) {
    return isoDate;
  }

  const parts = formatParts(longDateFormatter, date);

  return `${parts.day} ${parts.month} ${parts.year}`;
}

/**
 * `2026-10-11` → `11 Oct`.
 *
 * For chart axes and dense tables, where the full date does not fit and the year is
 * already implied by the range on screen. Same UTC anchoring as every other date
 * helper here, so a bar labelled `11 Oct` is the night of 11 October and not the
 * evening of the 10th in some other timezone.
 */
export function formatShortDate(isoDate: string): string {
  const date = parseDate(isoDate);

  if (!date) {
    return isoDate;
  }

  const parts = formatParts(shortDateFormatter, date);

  return `${parts.day} ${parts.month}`;
}

/** `11 October 2026` for a parsed date, without re-parsing the string. */
function longDate(date: Date): string {
  const parts = formatParts(longDateFormatter, date);

  return `${parts.day} ${parts.month} ${parts.year}`;
}

/**
 * Collapse a list of nights into a readable range.
 *
 * `["2026-10-11", …, "2026-10-19"]` → `11 – 19 October 2026`; ranges that span
 * months or years are spelled out in full (`11 October – 5 November 2026`).
 */
export function formatDateRange(isoDates: readonly string[]): string {
  const sorted = [...new Set(isoDates)]
    .map((value) => ({ value, date: parseDate(value) }))
    .sort(compareDates);

  if (sorted.length === 0) {
    return "";
  }

  if (sorted.length === 1) {
    return sorted[0].date ? longDate(sorted[0].date) : sorted[0].value;
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (!first.date || !last.date) {
    return sorted.map((entry) => entry.value).join(", ");
  }

  const sameMonth =
    first.date.getUTCFullYear() === last.date.getUTCFullYear() &&
    first.date.getUTCMonth() === last.date.getUTCMonth();

  if (sameMonth) {
    return `${formatParts(longDateFormatter, first.date).day} – ${longDate(last.date)}`;
  }

  return `${longDate(first.date)} – ${longDate(last.date)}`;
}

/** `19:00:00` → `7:00 PM`. Returns null for empty input. */
export function formatTimeOfDay(time: string | null): string | null {
  const match = /^(\d{2}):(\d{2})/.exec(time ?? "");

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;

  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

/** `19:00:00` + `23:30:00` → `7:00 PM – 11:30 PM`, or null when unknown. */
export function formatTimeRange(start: string | null, end: string | null): string | null {
  const from = formatTimeOfDay(start);
  const to = formatTimeOfDay(end);

  if (from && to) {
    return `${from} – ${to}`;
  }

  return from ? `From ${from}` : null;
}

/**
 * `2026-10-11T18:04:00.000Z` → `11 Oct 2026, 6:04 pm UTC`.
 *
 * A specific moment (when a booking was created, when a pass was scanned), as
 * opposed to a calendar date. Locale-independent and labelled UTC, so a timestamp
 * read at a gate or in a support reply is never ambiguous about which clock it
 * came from. Returns the raw value if it cannot be parsed.
 */
export function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours24 = date.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${String(date.getUTCDate()).padStart(2, "0")} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours12}:${minutes} ${hours24 < 12 ? "am" : "pm"} UTC`;
}

/**
 * Format a whole-rupee amount, e.g. `399` → `"₹399"`.
 *
 * Uses `Intl.NumberFormat` so amounts group correctly per locale (₹1,099) and
 * stay whole rupees: Indian event pass prices have no paise, and fractional
 * rupees invite rounding bugs in money handling.
 */
export function formatInr(amount: number, currency: string = siteConfig.currency): string {
  return new Intl.NumberFormat(siteConfig.locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
