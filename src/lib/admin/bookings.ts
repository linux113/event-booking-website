/**
 * Booking management: the vocabulary the /admin/bookings screen, its CSV export and
 * the verification harness all share.
 *
 * This module is deliberately pure — no `server-only`, no Supabase import, nothing
 * that touches the network — for two reasons. It is the one place that decides what a
 * search *means* (which query strings are honoured, which are dropped, how a page of
 * results is framed), so it has to be readable and testable on its own; and the same
 * decisions have to hold for the list, the detail view, the paging links and the
 * export, which is only guaranteed if there is one implementation of them.
 *
 * Two rules it encodes, both of them about not lying to an operator:
 *
 *   1. **A filter value the schema does not know is dropped, never passed on.** If it
 *      were forwarded, Postgres would reject the call (for the uuid filter) or match
 *      nothing (for a status), and an empty list reads as "no such booking" — when the
 *      truth is "that is not a filter". Dropping it makes the screen ignore nonsense
 *      and show the filter bar's actual state.
 *   2. **Paging never asks for a page that cannot exist.** The page number is clamped
 *      and the offset derived from it, so a hand-edited `?page=-4` or `?page=99999`
 *      lands on a real page of the list rather than on an error.
 */

import { siteConfig } from "@/config/site";

/** Rows per page. Enough that most searches fit on one page, few enough to read. */
export const BOOKING_PAGE_SIZE = 25;

/** The database clamps its own limit too (1–100); this is the number it is sent. */
export const BOOKING_MAX_PAGE = 9999;

/** How long a search term may be. Longer is truncated, not refused. */
export const BOOKING_QUERY_MAX_LENGTH = 64;

/**
 * How much of a result set an export may contain, and how it is fetched.
 *
 * The database clamps a single call to 100 rows, so a larger export is read in batches
 * of 100 (see `collectBookingsForExport`). The cap exists so a mis-click on an
 * unfiltered list cannot ask Postgres for a full season twice over; the file says so in
 * its headers, and the screen says so before the click, so a partial export is never
 * mistaken for a complete one.
 */
export const EXPORT_MAX_ROWS = 5000;
export const EXPORT_BATCH_SIZE = 100;

// -----------------------------------------------------------------------------
// Rows, as the mapped service returns them
// -----------------------------------------------------------------------------

/**
 * One booking as the list renders it.
 *
 * The contact, money and gateway fields are `null` for a caller without
 * `bookings:view_contact` — *absent*, not blanked out later. The page never receives
 * a mobile number it must remember not to draw.
 */
export interface BookingRow {
  bookingUuid: string;
  reference: string;
  customerName: string;
  customerMobile: string | null;
  customerEmail: string | null;
  eventName: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  passName: string;
  passComposition: string | null;
  quantity: number;
  numberOfPeople: number;
  totalAmount: number | null;
  currency: string;
  bookingStatus: string;
  paymentStatus: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
  passesIssued: number;
  passesCheckedIn: number;
  passIds: string[];
  checkInTimes: string[];
}

/** A pass on one booking, from the detail view. */
export interface BookingPass {
  passId: string;
  passNumber: number;
  status: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  validDate: string;
}

/** One gate entry, from the detail view — including who let the guest in. */
export interface BookingCheckIn {
  passId: string;
  gate: string | null;
  notes: string | null;
  checkedInAt: string;
  staff: string | null;
}

/**
 * One Razorpay event recorded against the booking's order.
 *
 * This is the evidence behind the payment status: what the gateway said, when it was
 * received and what the site did about it. Nothing on this screen can change a payment
 * status; all it can do is show what arrived.
 */
export interface BookingPaymentEvent {
  eventId: string;
  eventType: string;
  outcome: string;
  amountPaise: number | null;
  receivedAt: string;
  processedAt: string | null;
}

/** Everything the detail view shows about one booking. */
export interface BookingDetail {
  bookingUuid: string;
  reference: string;
  customerName: string;
  customerMobile: string | null;
  customerEmail: string | null;
  eventName: string;
  eventSlug: string;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  passName: string;
  passComposition: string | null;
  quantity: number;
  numberOfPeople: number;
  subtotal: number | null;
  totalAmount: number | null;
  currency: string;
  bookingStatus: string;
  paymentStatus: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  passes: BookingPass[];
  checkIns: BookingCheckIn[];
  paymentEvents: BookingPaymentEvent[];
}

// -----------------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------------

/**
 * The filters the screen offers, with the words it uses for them.
 *
 * The values are exactly the strings the database validates against; the labels are
 * what an operator at 1 a.m. can read. "Payment started" is `created` — Razorpay has
 * an order but nothing has been captured, which is the state of an abandoned checkout
 * and worth being able to look at on its own.
 */
export interface FilterOption {
  value: string;
  label: string;
}

export const PAYMENT_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: "unpaid", label: "Not paid" },
  { value: "created", label: "Payment started" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

export const BOOKING_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
  { value: "refunded", label: "Refunded" },
];

export const CHECK_IN_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: "none", label: "Nobody in yet" },
  { value: "some", label: "Part of the group in" },
  { value: "all", label: "Everyone in" },
];

/** Every date filter is a range; these are the words the two ends use. */
export const DATE_FROM_LABEL = "Night from";
export const DATE_TO_LABEL = "Night to";

const PAYMENT_STATUSES = PAYMENT_STATUS_OPTIONS.map((option) => option.value);
const BOOKING_STATUSES = BOOKING_STATUS_OPTIONS.map((option) => option.value);
const CHECK_IN_STATUSES = CHECK_IN_STATUS_OPTIONS.map((option) => option.value);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A search: the term, the five filters and the page. */
export interface BookingQuery {
  q: string;
  dateFrom: string | null;
  dateTo: string | null;
  passCategoryId: string | null;
  paymentStatus: string | null;
  bookingStatus: string | null;
  checkInStatus: string | null;
  /** 1-based. */
  page: number;
}

export const EMPTY_BOOKING_QUERY: BookingQuery = {
  q: "",
  dateFrom: null,
  dateTo: null,
  passCategoryId: null,
  paymentStatus: null,
  bookingStatus: null,
  checkInStatus: null,
  page: 1,
};

/** What a page's `searchParams` looks like — one value or several, or nothing. */
export type SearchParamsInput = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  const single = Array.isArray(value) ? value[0] : value;

  return typeof single === "string" ? single : "";
}

/** One search term, cleaned: trimmed, single-line, and no longer than it needs to be. */
export function normaliseSearchTerm(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, BOOKING_QUERY_MAX_LENGTH)
    : "";
}

function isoDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) {
    return null;
  }

  // Rejects 2026-02-31 as well as 2026-13-01: a date the calendar does not have is
  // not a filter, and Postgres would refuse the comparison outright.
  const parsed = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function known(value: string, allowed: readonly string[]): string | null {
  return allowed.includes(value) ? value : null;
}

/**
 * Read a `BookingQuery` out of a URL's search parameters.
 *
 * Unknown filter values are dropped (see the note at the top), and a page number that
 * is not a positive whole number becomes page 1.
 */
export function parseBookingQuery(params: SearchParamsInput | undefined): BookingQuery {
  if (!params) {
    return EMPTY_BOOKING_QUERY;
  }

  const pass = first(params.pass).trim();
  const page = Number.parseInt(first(params.page), 10);

  return {
    q: normaliseSearchTerm(first(params.q)),
    dateFrom: isoDate(first(params.from).trim()),
    dateTo: isoDate(first(params.to).trim()),
    passCategoryId: UUID_PATTERN.test(pass) ? pass : null,
    paymentStatus: known(first(params.payment).trim(), PAYMENT_STATUSES),
    bookingStatus: known(first(params.status).trim(), BOOKING_STATUSES),
    checkInStatus: known(first(params.checkin).trim(), CHECK_IN_STATUSES),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, BOOKING_MAX_PAGE) : 1,
  };
}

/**
 * Read a `BookingQuery` out of an already-encoded query string (`q=nisha&page=3`).
 *
 * Used for the `back` parameter the detail page carries: a row opened from page 4 of a
 * filtered list returns to page 4 of that list rather than to the list's first page.
 * The string is untrusted and goes through the same parsing as the screen's own
 * parameters, so a hand-written `back` can only ever produce a valid search.
 */
export function parseBookingQueryString(value: unknown): BookingQuery {
  if (typeof value !== "string" || !value) {
    return EMPTY_BOOKING_QUERY;
  }

  const params: SearchParamsInput = {};

  for (const [key, entry] of new URLSearchParams(value).entries()) {
    params[key] = entry;
  }

  return parseBookingQuery(params);
}

/** Where "back to the list" points for a row opened under these filters. */
export function backToBookingsHref(query: BookingQuery): string {
  const search = bookingQueryToSearchParams(query);

  return search ? `/admin/bookings?${search}` : "/admin/bookings";
}

/**
 * The query as a URL search string (`q=nisha&payment=paid`), without the leading `?`.
 *
 * Empty values are left out entirely, so "all bookings" is `/admin/bookings` rather
 * than a URL full of blanks — which matters because that URL is what an operator
 * bookmarks and shares. Pagination is included only when it is not page 1.
 */
export function bookingQueryToSearchParams(query: BookingQuery): string {
  const params = new URLSearchParams();

  if (query.q) {
    params.set("q", query.q);
  }

  if (query.dateFrom) {
    params.set("from", query.dateFrom);
  }

  if (query.dateTo) {
    params.set("to", query.dateTo);
  }

  if (query.passCategoryId) {
    params.set("pass", query.passCategoryId);
  }

  if (query.paymentStatus) {
    params.set("payment", query.paymentStatus);
  }

  if (query.bookingStatus) {
    params.set("status", query.bookingStatus);
  }

  if (query.checkInStatus) {
    params.set("checkin", query.checkInStatus);
  }

  if (query.page > 1) {
    params.set("page", String(query.page));
  }

  return params.toString();
}

/** `/admin/bookings` or `/admin/bookings?q=…` — for links and the export href. */
export function bookingsHref(query: BookingQuery, overrides: Partial<BookingQuery> = {}): string {
  const search = bookingQueryToSearchParams({ ...query, ...overrides });

  return search ? `/admin/bookings?${search}` : "/admin/bookings";
}

/** The same filters, pointed at the CSV export. */
export function bookingsExportHref(query: BookingQuery): string {
  const search = bookingQueryToSearchParams({ ...query, page: 1 });

  return search ? `/admin/bookings/export?${search}` : "/admin/bookings/export";
}

/** True when the term or any filter is set — i.e. this is not the whole list. */
export function isFiltered(query: BookingQuery): boolean {
  return Boolean(
    query.q ||
      query.dateFrom ||
      query.dateTo ||
      query.passCategoryId ||
      query.paymentStatus ||
      query.bookingStatus ||
      query.checkInStatus,
  );
}

/**
 * True when the date range cannot match anything.
 *
 * An inverted range (`from` after `to`) is left as typed and passed to the database,
 * which correctly returns no rows; the screen says why in words rather than silently
 * swapping the two ends and showing results for a range nobody asked for.
 */
export function isInvertedDateRange(query: BookingQuery): boolean {
  return Boolean(query.dateFrom && query.dateTo && query.dateFrom > query.dateTo);
}

/** The zero-based offset the database is asked for. */
/** The zero-based row offset a page starts at. */
export function bookingOffset(page: number, pageSize: number = BOOKING_PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * pageSize;
}

/** How many pages a result set needs. Zero results is still one (empty) page. */
export function bookingPageCount(total: number, pageSize: number = BOOKING_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** `Showing 26–50 of 128` — the sentence above the table. Null when empty. */
export function pageSummary(page: number, pageSize: number, total: number): string | null {
  if (total <= 0) {
    return null;
  }

  const from = (Math.max(1, page) - 1) * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);

  return `Showing ${from}–${to} of ${total}`;
}

/**
 * The page numbers to draw around the current one.
 *
 * At most five, always including page 1 and the last page, so the control does not
 * grow into a hundred links after a season's worth of bookings.
 */
export function pageWindow(page: number, pages: number, span = 2): number[] {
  const current = Math.min(Math.max(1, page), pages);
  const first = Math.max(1, current - span);
  const last = Math.min(pages, first + span * 2);
  const numbers: number[] = [];

  for (let number = Math.max(1, last - span * 2); number <= last; number += 1) {
    numbers.push(number);
  }

  return numbers;
}

// -----------------------------------------------------------------------------
// Check-in wording
// -----------------------------------------------------------------------------

/**
 * The check-in column as a sentence.
 *
 * Three states, and the payment state is part of the answer: a booking whose payment
 * was never verified has no passes to admit, which is different from "nobody has
 * arrived yet" and must not read as the same thing.
 */
export function checkInSummary(row: {
  passesIssued: number;
  passesCheckedIn: number;
  paymentStatus: string;
}): string {
  if (row.passesIssued === 0) {
    return row.paymentStatus === "paid" ? "Pass not issued yet" : "No pass yet";
  }

  if (row.passesCheckedIn === 0) {
    return `Not in yet (${row.passesIssued})`;
  }

  if (row.passesCheckedIn >= row.passesIssued) {
    return row.passesIssued === 1 ? "Checked in" : `All ${row.passesIssued} in`;
  }

  return `${row.passesCheckedIn} of ${row.passesIssued} in`;
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

/**
 * One CSV cell.
 *
 * Two things happen here, both of them about exports that open correctly:
 *
 *   * the value is quoted when it contains a comma, a quote or a newline, and inner
 *     quotes are doubled — the rule every spreadsheet implements;
 *   * a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed
 *     with an apostrophe. Spreadsheets treat those as the start of a formula, and a
 *     guest whose name is `=1+1` should be a guest, not a calculation.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    return quoteCsv(`'${text}`);
  }

  return quoteCsv(text);
}

/** Quoting and escaping, in one place: `csvCell` above is how every caller writes a cell. */
function quoteCsv(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The export's columns.
 *
 * `contact: true` marks the columns that only a role with `bookings:view_contact` may
 * export. They are *not written at all* for anyone else — the header row itself omits
 * them, so a staff member's file is not a file full of empty columns that hints at
 * what it is missing.
 */
interface ExportColumn {
  header: string;
  contact: boolean;
  value: (row: BookingRow) => string | number | null;
}

const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { header: "Booking ID", contact: false, value: (row) => row.reference },
  { header: "Customer", contact: false, value: (row) => row.customerName },
  { header: "Mobile", contact: true, value: (row) => row.customerMobile },
  { header: "Email", contact: true, value: (row) => row.customerEmail },
  { header: "Event", contact: false, value: (row) => row.eventName },
  { header: "Date", contact: false, value: (row) => row.eventDate },
  { header: "Pass", contact: false, value: (row) => row.passName },
  { header: "Quantity", contact: false, value: (row) => row.quantity },
  { header: "People", contact: false, value: (row) => row.numberOfPeople },
  { header: "Amount", contact: true, value: (row) => row.totalAmount },
  { header: "Currency", contact: true, value: (row) => row.currency },
  { header: "Payment Status", contact: false, value: (row) => row.paymentStatus },
  { header: "Booking Status", contact: false, value: (row) => row.bookingStatus },
  { header: "Check-in Status", contact: false, value: (row) => row.passesCheckedIn },
  { header: "Passes Issued", contact: false, value: (row) => row.passesIssued },
  { header: "Pass IDs", contact: false, value: (row) => row.passIds.join(" ") },
  { header: "Created At", contact: false, value: (row) => row.createdAt },
  { header: "Razorpay Order ID", contact: true, value: (row) => row.razorpayOrderId },
  { header: "Razorpay Payment ID", contact: true, value: (row) => row.razorpayPaymentId },
];

/** The header row of an export, for the caller's role. */
export function csvHeader(includeContact: boolean): string[] {
  return EXPORT_COLUMNS.filter((column) => includeContact || !column.contact).map((column) => column.header);
}

/**
 * A result set as CSV text, without a leading byte-order mark.
 *
 * The check-in column is written as two numbers rather than a sentence: a spreadsheet
 * cannot sort "Not in yet (2)", and the export exists to be sorted and filtered.
 */
export function bookingsToCsv(rows: readonly BookingRow[], includeContact: boolean): string {
  const columns = EXPORT_COLUMNS.filter((column) => includeContact || !column.contact);
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  }

  // CRLF, as RFC 4180 asks for, so Excel on Windows opens it as a table.
  return lines.join("\r\n");
}

/**
 * The export's filename: `bookings-2026-09-22.csv`.
 *
 * Dated because these files end up in a downloads folder next to yesterday's, and
 * two files called `bookings.csv` is one file too many.
 */
export function bookingExportFileName(today: string = new Date().toISOString().slice(0, 10)): string {
  return `bookings-${DATE_PATTERN.test(today) ? today : siteConfig.timezone}.csv`;
}

/**
 * What the export may contain, in words — shown on the button's title and in messages,
 * because "download" is not a promise anybody should have to guess at.
 */
export function exportScopeNote(includeContact: boolean, rowCount: number): string {
  const rows = `${rowCount} ${rowCount === 1 ? "booking" : "bookings"}`;

  return includeContact
    ? `Download all ${rows} matching the current filters, with contact details and amounts.`
    : `Download all ${rows} matching the current filters. Contact details and amounts are not included for your role.`;
}
