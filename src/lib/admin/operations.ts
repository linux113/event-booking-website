/**
 * The two operations lists — payments and passes — as pure vocabulary.
 *
 * Same shape as `src/lib/admin/bookings.ts`, and deliberately so: the paging maths, the
 * CSV writer and the search-term rules are imported from that module rather than
 * reimplemented, because three admin lists that page differently, or escape a
 * spreadsheet formula differently, are three lists that disagree with each other. What
 * lives here is only what is particular to *these* screens: what a filter is called,
 * which values are real, and how a state is worded for somebody reading it at a gate.
 */

import {
  BOOKING_QUERY_MAX_LENGTH,
  bookingPageCount,
  bookingOffset,
  normaliseSearchTerm,
  type FilterOption,
  type SearchParamsInput,
} from "@/lib/admin/bookings";

/** Rows per page. The same 25 as the booking list — see `BOOKING_PAGE_SIZE`. */
export const OPERATIONS_PAGE_SIZE = 25;

function first(value: string | string[] | undefined): string {
  const single = Array.isArray(value) ? value[0] : value;

  return typeof single === "string" ? single : "";
}

/** A filter value the schema holds, or null. Anything else narrows nothing. */
function known(value: string, allowed: readonly string[]): string | null {
  return allowed.includes(value) ? value : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function pageNumber(value: string): number {
  const page = Number.parseInt(value, 10);

  return Number.isFinite(page) && page >= 1 ? Math.min(page, 9999) : 1;
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

/**
 * The outcomes a delivery can have, as the database records them.
 *
 * These are written by the payment functions, so the list is the vocabulary of those
 * functions rather than a UI convenience: `confirmed` and `already_confirmed` are two
 * different things (the first moved a booking, the second found it already moved), and
 * `duplicate` is the gateway sending the same delivery twice. An operator looking at
 * "why does this customer say they paid" needs to be able to tell them apart.
 */
export const PAYMENT_OUTCOMES: readonly FilterOption[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "already_confirmed", label: "Confirmed (already)" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
  { value: "ignored", label: "Ignored" },
  { value: "duplicate", label: "Duplicate" },
];

/** The deliveries the operations team most often goes looking for. */
export const PAYMENT_EVENT_TYPES: readonly FilterOption[] = [
  { value: "payment.captured", label: "payment.captured" },
  { value: "payment.failed", label: "payment.failed" },
  { value: "order.paid", label: "order.paid" },
  { value: "refund.processed", label: "refund.processed" },
  { value: "payment.refunded", label: "payment.refunded" },
  { value: "checkout.verified", label: "checkout.verified" },
];

const OUTCOME_VALUES = PAYMENT_OUTCOMES.map((option) => option.value);

/** A search of the gateway's deliveries: the term, two filters, a date range, a page. */
export interface PaymentQuery {
  q: string;
  outcome: string | null;
  eventType: string | null;
  from: string | null;
  to: string | null;
  page: number;
}

export const EMPTY_PAYMENT_QUERY: PaymentQuery = {
  q: "",
  outcome: null,
  eventType: null,
  from: null,
  to: null,
  page: 1,
};

export function parsePaymentQuery(params: SearchParamsInput | undefined): PaymentQuery {
  if (!params) {
    return EMPTY_PAYMENT_QUERY;
  }

  const eventType = first(params.event).trim();

  return {
    q: normaliseSearchTerm(first(params.q)),
    outcome: known(first(params.outcome).trim(), OUTCOME_VALUES),
    // An event type is free text from the gateway, so it is accepted as written
    // (trimmed and capped) rather than checked against a list the gateway may extend.
    eventType: eventType ? eventType.slice(0, BOOKING_QUERY_MAX_LENGTH) : null,
    from: isoDate(first(params.from).trim()),
    to: isoDate(first(params.to).trim()),
    page: pageNumber(first(params.page)),
  };
}

export function paymentQueryToSearchParams(query: PaymentQuery): string {
  const params = new URLSearchParams();

  if (query.q) {
    params.set("q", query.q);
  }

  if (query.outcome) {
    params.set("outcome", query.outcome);
  }

  if (query.eventType) {
    params.set("event", query.eventType);
  }

  if (query.from) {
    params.set("from", query.from);
  }

  if (query.to) {
    params.set("to", query.to);
  }

  if (query.page > 1) {
    params.set("page", String(query.page));
  }

  return params.toString();
}

export function paymentsHref(query: PaymentQuery, overrides: Partial<PaymentQuery> = {}): string {
  const search = paymentQueryToSearchParams({ ...query, ...overrides });

  return search ? `/admin/payments?${search}` : "/admin/payments";
}

export function isPaymentFiltered(query: PaymentQuery): boolean {
  return Boolean(query.q || query.outcome || query.eventType || query.from || query.to);
}

export function paymentOffset(page: number, pageSize: number = OPERATIONS_PAGE_SIZE): number {
  return bookingOffset(page, pageSize);
}

/** How many pages a result set has. One, at minimum: an empty list still has a page 1. */
export function operationsPageCount(total: number, pageSize: number = OPERATIONS_PAGE_SIZE): number {
  return bookingPageCount(total, pageSize);
}

/**
 * Read a `PaymentQuery` out of an already-encoded query string (`outcome=refunded`).
 *
 * The same parsing the screen's own parameters go through, so a hand-written or stale
 * query string can only ever produce a valid search.
 */
export function parsePaymentQueryString(value: unknown): PaymentQuery {
  if (typeof value !== "string" || !value) {
    return EMPTY_PAYMENT_QUERY;
  }

  const params: SearchParamsInput = {};

  for (const [key, entry] of new URLSearchParams(value).entries()) {
    params[key] = entry;
  }

  return parsePaymentQuery(params);
}

// -----------------------------------------------------------------------------
// Passes
// -----------------------------------------------------------------------------

export const PASS_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: "active", label: "Active" },
  { value: "used", label: "Used" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

export const PASS_CHECK_IN_OPTIONS: readonly FilterOption[] = [
  { value: "out", label: "Not admitted yet" },
  { value: "in", label: "Admitted" },
];

const PASS_STATUS_VALUES = PASS_STATUS_OPTIONS.map((option) => option.value);
const PASS_CHECK_IN_VALUES = PASS_CHECK_IN_OPTIONS.map((option) => option.value);

/** A search of the issued passes: the term, three filters, a night range, a page. */
export interface PassQuery {
  q: string;
  status: string | null;
  checkIn: string | null;
  eventDateId: string | null;
  from: string | null;
  to: string | null;
  page: number;
}

export const EMPTY_PASS_QUERY: PassQuery = {
  q: "",
  status: null,
  checkIn: null,
  eventDateId: null,
  from: null,
  to: null,
  page: 1,
};

export function parsePassQuery(params: SearchParamsInput | undefined): PassQuery {
  if (!params) {
    return EMPTY_PASS_QUERY;
  }

  const night = first(params.night).trim();

  return {
    q: normaliseSearchTerm(first(params.q)),
    status: known(first(params.status).trim(), PASS_STATUS_VALUES),
    checkIn: known(first(params.checkin).trim(), PASS_CHECK_IN_VALUES),
    eventDateId: UUID_PATTERN.test(night) ? night : null,
    from: isoDate(first(params.from).trim()),
    to: isoDate(first(params.to).trim()),
    page: pageNumber(first(params.page)),
  };
}

export function passQueryToSearchParams(query: PassQuery): string {
  const params = new URLSearchParams();

  if (query.q) {
    params.set("q", query.q);
  }

  if (query.status) {
    params.set("status", query.status);
  }

  if (query.checkIn) {
    params.set("checkin", query.checkIn);
  }

  if (query.eventDateId) {
    params.set("night", query.eventDateId);
  }

  if (query.from) {
    params.set("from", query.from);
  }

  if (query.to) {
    params.set("to", query.to);
  }

  if (query.page > 1) {
    params.set("page", String(query.page));
  }

  return params.toString();
}

export function passesHref(query: PassQuery, overrides: Partial<PassQuery> = {}): string {
  const search = passQueryToSearchParams({ ...query, ...overrides });

  return search ? `/admin/passes?${search}` : "/admin/passes";
}

/** The same filters, pointed at the door-list export. */
export function passesExportHref(query: PassQuery): string {
  const search = passQueryToSearchParams({ ...query, page: 1 });

  return search ? `/admin/passes/export?${search}` : "/admin/passes/export";
}

export function isPassFiltered(query: PassQuery): boolean {
  return Boolean(query.q || query.status || query.checkIn || query.eventDateId || query.from || query.to);
}

export function passOffset(page: number, pageSize: number = OPERATIONS_PAGE_SIZE): number {
  return bookingOffset(page, pageSize);
}

/** Read a `PassQuery` out of an already-encoded query string (`checkin=in&night=…`). */
export function parsePassQueryString(value: unknown): PassQuery {
  if (typeof value !== "string" || !value) {
    return EMPTY_PASS_QUERY;
  }

  const params: SearchParamsInput = {};

  for (const [key, entry] of new URLSearchParams(value).entries()) {
    params[key] = entry;
  }

  return parsePassQuery(params);
}

/**
 * A pass's state as a sentence for the door.
 *
 * `status` and `checked_in` are two facts, not one: a pass that was admitted and then
 * cancelled by a refund is still `cancelled`, and still a pass that let somebody in.
 * The wording keeps both visible rather than picking one, because at a gate the
 * difference between "this person never came" and "this person came and then got their
 * money back" is the whole question.
 */
export function passState(row: { passStatus: string; checkedIn: boolean }): string {
  const admitted = row.checkedIn ? "Admitted" : "Not admitted yet";

  switch (row.passStatus) {
    case "active":
      return admitted;
    case "used":
      return row.checkedIn ? "Admitted" : "Used — no entry recorded";
    case "cancelled":
      return row.checkedIn ? "Cancelled after entry" : "Cancelled";
    case "expired":
      return "Expired";
    default:
      return `${row.passStatus} · ${admitted}`;
  }
}

/** How an outcome or a status should read as a pill, in one word where possible. */
export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "confirmed":
      return "confirmed";
    case "already_confirmed":
      return "confirmed";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "ignored":
      return "ignored";
    case "duplicate":
      return "duplicate";
    default:
      return outcome;
  }
}

/**
 * Whether an outcome is a problem worth a second look.
 *
 * Used to colour the pill. `ignored` and `duplicate` are not failures — one is a
 * delivery we deliberately did nothing with, the other is the gateway retrying — but
 * both are the kinds of thing somebody asks about, so neither is coloured as success.
 */
export function outcomeTone(outcome: string): "go" | "warn" | "stop" {
  if (outcome === "confirmed" || outcome === "already_confirmed") {
    return "go";
  }

  if (outcome === "duplicate" || outcome === "ignored") {
    return "warn";
  }

  return "stop";
}

/** Rupees from the gateway's paise, for display. Null stays null. */
export function paiseToRupees(paise: number | null): number | null {
  return paise === null ? null : Math.round(paise / 100);
}

/**
 * The columns a door list has, in the order a person reads them.
 *
 * Shared by the table, the export and the tests. `contact: true` marks the columns a
 * role without `bookings:view_contact` may not have — and for that role they are absent
 * from the header row, not blank: a file of empty columns still tells you what you are
 * missing, which is not the same as not being allowed to know it.
 */
export interface PassExportColumn {
  header: string;
  contact: boolean;
  value: (row: PassExportRow) => string | number | null;
}

/** The fields the export needs from a pass row. */
export interface PassExportRow {
  passId: string;
  passNumber: number;
  passStatus: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  validDate: string;
  gate: string | null;
  admittedBy: string | null;
  bookingId: string;
  bookingStatus: string;
  paymentStatus: string;
  customerName: string;
  customerMobile: string | null;
  passName: string;
  passesOnBooking: number;
  totalAmount: number | null;
  currency: string;
  issuedAt: string;
}

export const PASS_EXPORT_COLUMNS: readonly PassExportColumn[] = [
  { header: "Pass ID", contact: false, value: (row) => row.passId },
  { header: "Pass Number", contact: false, value: (row) => row.passNumber },
  { header: "Passes On Booking", contact: false, value: (row) => row.passesOnBooking },
  { header: "Customer", contact: false, value: (row) => row.customerName },
  { header: "Mobile", contact: true, value: (row) => row.customerMobile },
  { header: "Booking ID", contact: false, value: (row) => row.bookingId },
  { header: "Booking Status", contact: false, value: (row) => row.bookingStatus },
  { header: "Payment Status", contact: false, value: (row) => row.paymentStatus },
  { header: "Pass", contact: false, value: (row) => row.passName },
  { header: "Valid Date", contact: false, value: (row) => row.validDate },
  { header: "Pass Status", contact: false, value: (row) => row.passStatus },
  { header: "Checked In", contact: false, value: (row) => (row.checkedIn ? "yes" : "no") },
  { header: "Checked In At", contact: false, value: (row) => row.checkedInAt },
  { header: "Gate", contact: false, value: (row) => row.gate },
  { header: "Admitted By", contact: false, value: (row) => row.admittedBy },
  { header: "Amount", contact: true, value: (row) => row.totalAmount },
  { header: "Currency", contact: true, value: (row) => row.currency },
  { header: "Issued At", contact: false, value: (row) => row.issuedAt },
];

/**
 * How many passes a door list may hold, and how many are fetched at a time.
 *
 * A gate team prints this list, so it is the one export expected to cover the whole event
 * rather than the current page. The two numbers mirror the booking export
 * (`EXPORT_MAX_ROWS`/`EXPORT_BATCH_SIZE`), for the same two reasons: the database clamps
 * a single call to 100 rows, and nobody is served by a 40,000-line file.
 */
export const PASS_EXPORT_MAX_ROWS = 5000;
export const PASS_EXPORT_BATCH_SIZE = 100;

/** The door list's filename: `passes-2026-09-22.csv`, dated for the day it was made. */
export function passExportFileName(today: string = new Date().toISOString().slice(0, 10)): string {
  return `passes-${DATE_PATTERN.test(today) ? today : "export"}.csv`;
}
