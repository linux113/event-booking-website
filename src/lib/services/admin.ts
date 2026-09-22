import "server-only";

import { siteConfig } from "@/config/site";
import { can, ROLE_LABELS, type StaffRole } from "@/lib/auth/permissions";
import {
  BOOKING_PAGE_SIZE,
  EXPORT_BATCH_SIZE,
  EXPORT_MAX_ROWS,
  bookingOffset,
  normaliseSearchTerm,
  type BookingDetail,
  type BookingQuery,
  type BookingRow,
  type FilterOption,
} from "@/lib/admin/bookings";
import { gateNight } from "@/lib/gate/night";
import { getAdminClient } from "@/lib/services/admin-client";
import { fail, ok, type Result } from "@/lib/services/result";
import type { Database } from "@/types/database";

/**
 * Reads for the admin area — server side only.
 *
 * Three rules shape this module:
 *
 *   1. **The database counts and filters, not the app.** `admin_search_bookings()`,
 *      `admin_booking_detail()` and `admin_dashboard_stats()` are `service_role`-only
 *      functions, so the admin area never pulls a table into Node to add it up or to
 *      filter it, and an unsupported filter can never quietly widen a result set.
 *   2. **A role decides the *shape* of the data, not just the door.** The staff view
 *      is requested with `p_include_contact = false`, so contact details, amounts and
 *      gateway ids are never returned at all. Redaction that happens upstream of the
 *      component cannot be forgotten by a component.
 *   3. **No service-role key ever leaves the server.** Everything here runs on the
 *      server and returns plain objects; the browser gets rendered HTML.
 */

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

type StatsRow = Database["public"]["Functions"]["admin_dashboard_stats"]["Returns"][number];
type SeriesRow = Database["public"]["Functions"]["admin_booking_series"]["Returns"][number];
type BreakdownRow = Database["public"]["Functions"]["admin_pass_breakdown"]["Returns"][number];
type RecentRow = Database["public"]["Functions"]["admin_recent_bookings"]["Returns"][number];

export type DashboardStats = StatsRow;
export type DashboardSeriesPoint = SeriesRow;
export type PassCategoryBreakdown = BreakdownRow;
export type RecentBooking = RecentRow;

/** How much history the charts cover, and how many bookings the table lists. */
export const DASHBOARD_WINDOW_DAYS = 14;
export const DASHBOARD_RECENT_LIMIT = 8;

/**
 * Everything the dashboard shows, in the shape the caller's role is allowed to see.
 *
 * Four aggregates, fetched together: the headline numbers, the day-by-day series, the
 * pass-category distribution and the newest bookings. Each one is counted by the
 * database (`admin_dashboard_stats`, `admin_booking_series`, `admin_pass_breakdown`,
 * `admin_recent_bookings`) — this function passes the role's two capabilities down to
 * the queries and never adds anything up itself.
 *
 * `includeRevenue` and `includeContact` are decided here from the role, and they are
 * the *only* thing that differs between a staff dashboard and an admin one: the same
 * page renders the same components, but a staff session's response carries no amounts
 * and no contact details because the database never returned them.
 *
 * `today` is the venue's date (`gateNight()`), not the server's, so "today" on the
 * dashboard means the day it is where the event is.
 */
export interface DashboardSnapshot {
  /** The venue's date, as the figures were counted. */
  today: string;
  /** The timezone those days were measured in (`siteConfig.timezone`). */
  timezone: string;
  includeRevenue: boolean;
  includeContact: boolean;
  windowDays: number;
  stats: DashboardStats;
  series: DashboardSeriesPoint[];
  breakdown: PassCategoryBreakdown[];
  recent: RecentBooking[];
}

export async function getDashboardSnapshot(role: StaffRole): Promise<Result<DashboardSnapshot | null>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const today = gateNight();
  const includeRevenue = can(role, "payments:view");
  const includeContact = can(role, "bookings:view_contact");

  // One round trip's worth of latency for the whole page: the four queries are
  // independent, so they go out together.
  const [stats, series, breakdown, recent] = await Promise.all([
    client.client.rpc("admin_dashboard_stats", {
      p_today: today,
      p_tz: siteConfig.timezone,
      p_include_revenue: includeRevenue,
    }),
    client.client.rpc("admin_booking_series", {
      p_today: today,
      p_days: DASHBOARD_WINDOW_DAYS,
      p_tz: siteConfig.timezone,
      p_include_revenue: includeRevenue,
    }),
    client.client.rpc("admin_pass_breakdown", { p_include_revenue: includeRevenue }),
    client.client.rpc("admin_recent_bookings", {
      p_limit: DASHBOARD_RECENT_LIMIT,
      p_include_contact: includeContact,
    }),
  ]);

  const failure = [stats, series, breakdown, recent].find((response) => response.error);

  if (failure?.error) {
    console.error("[admin] dashboard read failed:", failure.error.message, failure.error.code);

    return fail("query-failed", "We could not load the dashboard numbers right now.");
  }

  const statsRow = (Array.isArray(stats.data) ? stats.data : [])[0];

  if (!statsRow) {
    // The migrations have not been applied yet: an empty answer, not an error.
    return ok(null);
  }

  return ok({
    today,
    timezone: siteConfig.timezone,
    includeRevenue,
    includeContact,
    windowDays: DASHBOARD_WINDOW_DAYS,
    stats: statsRow,
    series: Array.isArray(series.data) ? series.data : [],
    breakdown: Array.isArray(breakdown.data) ? breakdown.data : [],
    recent: Array.isArray(recent.data) ? recent.data : [],
  });
}

// -----------------------------------------------------------------------------
// Booking management
// -----------------------------------------------------------------------------

type SearchRow = Database["public"]["Functions"]["admin_search_bookings"]["Returns"][number];
type DetailRow = Database["public"]["Functions"]["admin_booking_detail"]["Returns"][number];

function mapBookingRow(row: SearchRow): BookingRow {
  return {
    bookingUuid: row.booking_uuid,
    reference: row.booking_id,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
    customerEmail: row.customer_email,
    eventName: row.event_name,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    passName: row.pass_name,
    passComposition: row.pass_composition,
    quantity: row.quantity,
    numberOfPeople: row.number_of_people,
    totalAmount: row.total_amount,
    currency: row.currency,
    bookingStatus: row.booking_status,
    paymentStatus: row.payment_status,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    createdAt: row.created_at,
    passesIssued: row.passes_issued,
    passesCheckedIn: row.passes_checked_in,
    passIds: Array.isArray(row.pass_ids) ? row.pass_ids : [],
    checkInTimes: Array.isArray(row.check_in_times) ? row.check_in_times : [],
  };
}

/**
 * `jsonb` arrives as whatever the client deserialised it into, which is a plain object
 * for `jsonb_agg`. The three arrays are rebuilt field by field rather than trusted, so
 * a change in the database surfaces as a missing field in TypeScript instead of an
 * undefined rendered into the page.
 */
function mapDetail(row: DetailRow): BookingDetail {
  const passes = Array.isArray(row.passes) ? row.passes : [];
  const checkIns = Array.isArray(row.check_ins) ? row.check_ins : [];
  const events = Array.isArray(row.payment_events) ? row.payment_events : [];

  return {
    bookingUuid: row.booking_uuid,
    reference: row.booking_id,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
    customerEmail: row.customer_email,
    eventName: row.event_name,
    eventSlug: row.event_slug,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    passName: row.pass_name,
    passComposition: row.pass_composition,
    quantity: row.quantity,
    numberOfPeople: row.number_of_people,
    subtotal: row.subtotal,
    totalAmount: row.total_amount,
    currency: row.currency,
    bookingStatus: row.booking_status,
    paymentStatus: row.payment_status,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passes: passes.map((pass) => ({
      passId: pass.pass_id,
      passNumber: pass.pass_number,
      status: pass.status,
      checkedIn: pass.checked_in,
      checkedInAt: pass.checked_in_at,
      validDate: pass.valid_date,
    })),
    checkIns: checkIns.map((entry) => ({
      passId: entry.pass_id,
      gate: entry.gate,
      notes: entry.notes,
      checkedInAt: entry.checked_in_at,
      staff: entry.staff,
    })),
    paymentEvents: events.map((event) => ({
      eventId: event.event_id,
      eventType: event.event_type,
      outcome: event.outcome,
      amountPaise: event.amount_paise,
      receivedAt: event.received_at,
      processedAt: event.processed_at,
    })),
  };
}

/** One page of the booking list. */
export interface BookingPage {
  rows: BookingRow[];
  /** Bookings matching the filters, not rows on this page. */
  total: number;
  page: number;
  pageSize: number;
  /** False for roles without `bookings:view_contact` — see `permissions.ts`. */
  includeContact: boolean;
}

/**
 * The filter arguments, exactly as the database function expects them.
 *
 * `undefined` and `null` are different things here: a filter that is not set is sent
 * as `null` so the function's `p_x is null` branch skips it, and nothing is ever sent
 * as an empty string — Postgres would compare `''` against a uuid column and refuse
 * the call.
 */
function filterArgs(query: BookingQuery) {
  return {
    p_query: query.q || null,
    p_event_date_from: query.dateFrom,
    p_event_date_to: query.dateTo,
    p_pass_category_id: query.passCategoryId,
    p_payment_status: query.paymentStatus,
    p_booking_status: query.bookingStatus,
    p_check_in_status: query.checkInStatus,
  };
}

/**
 * The booking list: search, filters, paging.
 *
 * The whole of it happens in Postgres (`admin_search_bookings`) — the search term, the
 * five filters, the ordering, the page slice and the count of the full result set. Two
 * consequences worth stating plainly:
 *
 *   * this function never sees a booking it was not asked for, because the database
 *     applies the filters and returns one page;
 *   * `total` is the size of the *whole* match, so the screen can say "26–50 of 128"
 *     without the app counting anything.
 *
 * The role decides whether contact details, amounts and gateway ids are returned at
 * all, via `p_include_contact`. There is no path through this function that fetches
 * them and then hides them.
 */
export async function listBookings(query: BookingQuery, role: StaffRole): Promise<Result<BookingPage>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const includeContact = can(role, "bookings:view_contact");
  const { data, error } = await client.client.rpc("admin_search_bookings", {
    ...filterArgs(query),
    p_include_contact: includeContact,
    p_limit: BOOKING_PAGE_SIZE,
    p_offset: bookingOffset(query.page),
  });

  if (error) {
    console.error("[admin] admin_search_bookings failed:", error.message, error.code);

    return fail("query-failed", "We could not search bookings right now.");
  }

  const rows = Array.isArray(data) ? data : [];

  return ok({
    // `total_count` is a window count: every row of the result set carries the size of
    // the whole set, so it is read here and kept out of the screen's row shape.
    rows: rows.map(mapBookingRow),
    total: rows[0]?.total_count ?? 0,
    page: query.page,
    pageSize: BOOKING_PAGE_SIZE,
    includeContact,
  });
}

/**
 * Every booking matching the filters, for the CSV export.
 *
 * Returns the rows it managed to fetch and whether the cap stopped it early, so the
 * caller can say "the first 5000 of 12345" instead of pretending the file is complete.
 */
export async function collectBookingsForExport(
  query: BookingQuery,
  role: StaffRole,
  maxRows: number = EXPORT_MAX_ROWS,
): Promise<Result<{ rows: BookingRow[]; includeContact: boolean; truncated: boolean }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const includeContact = can(role, "bookings:view_contact");
  const rows: BookingRow[] = [];
  let offset = 0;
  let total = 0;

  // Sequential on purpose: the loop stops as soon as the match is exhausted, so the
  // usual export is one call, and the count of pages needed comes from the first answer.
  for (;;) {
    const { data, error } = await client.client.rpc("admin_search_bookings", {
      ...filterArgs(query),
      p_include_contact: includeContact,
      p_limit: EXPORT_BATCH_SIZE,
      p_offset: offset,
    });

    if (error) {
      console.error("[admin] booking export failed:", error.message, error.code);

      return fail("query-failed", "We could not build the export right now.");
    }

    const batch = Array.isArray(data) ? data : [];

    total = batch[0]?.total_count ?? total;

    rows.push(...batch.map(mapBookingRow));
    offset += batch.length;

    // Two reasons to stop: the match is exhausted (a short batch, or an empty one), or
    // the caller's ceiling has been reached. `truncated` below is what tells the two
    // apart — and it is computed from the count, not from which branch was taken.
    if (batch.length < EXPORT_BATCH_SIZE || rows.length >= maxRows) {
      break;
    }
  }

  return ok({
    rows: rows.slice(0, maxRows),
    includeContact,
    // Incomplete means: the database says there are more bookings than this file has.
    // A partial export that claimed to be complete would be the one genuinely dangerous
    // thing an export can do, so the flag comes from the count rather than the loop.
    truncated: rows.length < total,
  });
}

/**
 * One booking in full, by booking reference, pass id, payment id or order id.
 *
 * `null` means no booking carries that identifier — an answer, not an error, and the
 * page renders it as "nothing here" rather than as a failure.
 *
 * The pass list, the gate entries and the Razorpay events come back inside the one
 * row. The QR token does not come back at all: the credential that admits a guest is
 * not a screen's business, and this is the function that would otherwise be handing it
 * out.
 */
export async function getBookingDetail(
  lookup: unknown,
  role: StaffRole,
): Promise<Result<BookingDetail | null>> {
  const term = normaliseSearchTerm(lookup);

  if (!term) {
    return ok(null);
  }

  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client.rpc("admin_booking_detail", {
    p_lookup: term,
    p_include_contact: can(role, "bookings:view_contact"),
  });

  if (error) {
    console.error("[admin] admin_booking_detail failed:", error.message, error.code);

    return fail("query-failed", "We could not load that booking right now.");
  }

  const [row] = Array.isArray(data) ? data : [];

  return ok(row ? mapDetail(row) : null);
}

/** The pass categories the filter bar offers: what an event actually sells. */
export async function listBookingPassOptions(): Promise<Result<FilterOption[]>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client
    .from("pass_categories")
    .select("id, name, price_inr, is_active, sort_order")
    .order("sort_order", { ascending: true })
    .order("price_inr", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[admin] pass_categories read failed:", error.message, error.code);

    // The filter bar is not the page: without the pass list a manager can still search
    // and filter by everything else, so this is reported as an empty option list.
    return ok([]);
  }

  return ok(
    (data ?? []).map((row) => ({
      value: row.id,
      // A retired pass category still has bookings against it, so it stays in the
      // filter — labelled, because "Duo (retired)" is a filter, and a category the
      // operator cannot find is a booking they cannot look up.
      label: row.is_active ? row.name : `${row.name} (retired)`,
    })),
  );
}

// -----------------------------------------------------------------------------
// Staff accounts
// -----------------------------------------------------------------------------

export interface StaffAccountRow {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: string;
  roleLabel: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Every account on the allow-list, for the super admin's staff page.
 *
 * Read-only: creating staff is done in Supabase (Authentication → Users) and then
 * allow-listed here, and changing a role is a deliberate database write. A UI that
 * could edit roles from a page would deserve its own "you cannot demote the last
 * super admin" rules, which is a job for the settings step — not something to bolt
 * on beside a read-only list.
 */
export async function listStaffAccounts(): Promise<Result<StaffAccountRow[]>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client
    .from("admin_users")
    .select("id, user_id, email, full_name, role, is_active, last_login_at, created_at")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[admin] admin_users read failed:", error.message, error.code);

    return fail("query-failed", "We could not load the staff list right now.");
  }

  return ok(
    (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      roleLabel: ROLE_LABELS[row.role as StaffRole] ?? row.role,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    })),
  );
}

export interface EventSettings {
  name: string;
  slug: string;
  status: string;
  tagline: string | null;
  venueName: string;
  venueAddress: string | null;
  city: string;
  state: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  currency: string;
}

/** The event row the public site reads — what "settings" means today. */
export async function getEventSettings(): Promise<Result<EventSettings | null>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client
    .from("events")
    .select("name, slug, status, tagline, venue_name, venue_address, city, state, contact_phone, contact_email, currency")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[admin] events read failed:", error.message, error.code);

    return fail("query-failed", "We could not load the event settings right now.");
  }

  if (!data) {
    return ok(null);
  }

  return ok({
    name: data.name,
    slug: data.slug,
    status: data.status,
    tagline: data.tagline,
    venueName: data.venue_name,
    venueAddress: data.venue_address,
    city: data.city,
    state: data.state,
    contactPhone: data.contact_phone,
    contactEmail: data.contact_email,
    currency: data.currency,
  });
}
