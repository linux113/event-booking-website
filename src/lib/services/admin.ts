import "server-only";

import { siteConfig } from "@/config/site";
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
import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc, sql } from "@/lib/db/client";
import { gateNight } from "@/lib/gate/night";
import { fail, ok, type Result } from "@/lib/services/result";

/**
 * Reads for the admin area — server side only.
 *
 * One administrator with full access: contact details and amounts are always
 * returned. Aggregation still happens in Postgres (`admin_dashboard_stats`,
 * `admin_search_bookings`, …) so totals cannot drift from the rows they
 * describe, and a filter can never be applied only in the app.
 */

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

export interface DashboardStats {
  bookings_total: number;
  bookings_confirmed: number;
  bookings_pending: number;
  bookings_today: number;
  bookings_refunded: number;
  revenue_total: number;
  revenue_today: number;
  revenue_refunded: number | null;
  check_ins_total: number;
  check_ins_today: number;
  people_paid: number;
  capacity_available: number;
  capacity_taken: number;
  capacity_total: number;
  nights_total: number;
  nights_upcoming: number;
  tonight_date: string | null;
  tonight_capacity: number;
  tonight_taken: number;
  tonight_available: number;
  passes_issued: number;
  passes_used: number;
  passes_active: number;
  gallery_published: number;
  gallery_draft: number;
  /** Absent when roles/admin_users are gone (single-admin schema). */
  staff_active?: number | null;
  staff_total?: number | null;
}

export interface DashboardSeriesPoint {
  day: string;
  bookings: number;
  confirmed: number;
  revenue: number | null;
}

export interface PassCategoryBreakdown {
  pass_category_id: string;
  pass_name: string;
  pass_composition: string | null;
  price_inr: number;
  is_active: boolean;
  bookings: number;
  paid_bookings: number;
  passes_issued: number;
  people: number;
  revenue: number | null;
}

export interface RecentBooking {
  booking_uuid: string;
  booking_id: string;
  customer_name: string;
  customer_mobile: string | null;
  quantity: number;
  number_of_people: number;
  total_amount: number;
  currency: string;
  booking_status: string;
  payment_status: string;
  pass_name: string | null;
  event_date: string;
  created_at: string;
}

/** How much history the charts cover, and how many bookings the table lists. */
export const DASHBOARD_WINDOW_DAYS = 14;
export const DASHBOARD_RECENT_LIMIT = 8;

export interface DashboardSnapshot {
  /** The venue's date, as the figures were counted. */
  today: string;
  timezone: string;
  includeRevenue: boolean;
  includeContact: boolean;
  windowDays: number;
  stats: DashboardStats;
  series: DashboardSeriesPoint[];
  breakdown: PassCategoryBreakdown[];
  recent: RecentBooking[];
}

function ensureDb(): Result<never> | null {
  if (!isDatabaseConfigured()) {
    return fail("not-configured", "The admin area needs the database: add DATABASE_URL and try again.");
  }
  return null;
}

function dbFailure(context: string, error: unknown): Result<never> {
  if (error instanceof DatabaseError) {
    console.error(`[admin] ${context} failed:`, error.message, error.code ?? "");
  } else {
    console.error(`[admin] ${context} failed:`, error);
  }
  return fail("query-failed", "We could not load that right now.");
}

/** Everything the dashboard shows. Single admin → full revenue and contact. */
export async function getDashboardSnapshot(): Promise<Result<DashboardSnapshot | null>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<DashboardSnapshot | null>;

  const today = gateNight();
  const includeRevenue = true;
  const includeContact = true;

  try {
    const [stats, series, breakdown, recent] = await Promise.all([
      rpc("admin_dashboard_stats", {
        p_today: today,
        p_tz: siteConfig.timezone,
        p_include_revenue: includeRevenue,
      }),
      rpc("admin_booking_series", {
        p_today: today,
        p_days: DASHBOARD_WINDOW_DAYS,
        p_tz: siteConfig.timezone,
        p_include_revenue: includeRevenue,
      }),
      rpc("admin_pass_breakdown", { p_include_revenue: includeRevenue }),
      rpc("admin_recent_bookings", {
        p_limit: DASHBOARD_RECENT_LIMIT,
        p_include_contact: includeContact,
      }),
    ]);

    const statsRow = stats[0];

    if (!statsRow) {
      // Migrations not applied yet: an empty answer, not an error.
      return ok(null);
    }

    return ok({
      today,
      timezone: siteConfig.timezone,
      includeRevenue,
      includeContact,
      windowDays: DASHBOARD_WINDOW_DAYS,
      stats: statsRow as unknown as DashboardStats,
      series: (series ?? []) as unknown as DashboardSeriesPoint[],
      breakdown: (breakdown ?? []) as unknown as PassCategoryBreakdown[],
      recent: (recent ?? []) as unknown as RecentBooking[],
    });
  } catch (error) {
    return dbFailure("dashboard", error) as Result<DashboardSnapshot | null>;
  }
}

// -----------------------------------------------------------------------------
// Booking management
// -----------------------------------------------------------------------------

type SearchRow = {
  booking_uuid: string;
  booking_id: string;
  customer_name: string;
  customer_mobile: string | null;
  event_name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  pass_name: string;
  pass_composition: string | null;
  quantity: number;
  number_of_people: number;
  total_amount: number;
  currency: string;
  booking_status: string;
  payment_status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
  passes_issued: number;
  passes_checked_in: number;
  pass_ids: string[] | null;
  check_in_times: string[] | null;
  total_count?: number;
};

type DetailRow = {
  booking_uuid: string;
  booking_id: string;
  customer_name: string;
  customer_mobile: string | null;
  event_name: string;
  event_slug: string;
  venue_name: string;
  venue_address: string | null;
  city: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  pass_name: string;
  pass_composition: string | null;
  quantity: number;
  number_of_people: number;
  subtotal: number;
  total_amount: number;
  currency: string;
  booking_status: string;
  payment_status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  passes: unknown;
  check_ins: unknown;
  payment_events: unknown;
};

function mapBookingRow(row: SearchRow): BookingRow {
  return {
    bookingUuid: row.booking_uuid,
    reference: row.booking_id,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
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

function mapDetail(row: DetailRow): BookingDetail {
  const passes = Array.isArray(row.passes) ? row.passes : [];
  const checkIns = Array.isArray(row.check_ins) ? row.check_ins : [];
  const events = Array.isArray(row.payment_events) ? row.payment_events : [];

  return {
    bookingUuid: row.booking_uuid,
    reference: row.booking_id,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
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
    passes: passes.map((pass) => {
      const p = pass as Record<string, unknown>;
      return {
        passId: p.pass_id as string,
        passNumber: p.pass_number as number,
        status: p.status as string,
        checkedIn: p.checked_in as boolean,
        checkedInAt: (p.checked_in_at as string | null) ?? null,
        validDate: p.valid_date as string,
      };
    }),
    checkIns: checkIns.map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        passId: e.pass_id as string,
        gate: (e.gate as string | null) ?? null,
        notes: (e.notes as string | null) ?? null,
        checkedInAt: e.checked_in_at as string,
        staff: (e.staff as string | null) ?? null,
      };
    }),
    paymentEvents: events.map((event) => {
      const ev = event as Record<string, unknown>;
      return {
        eventId: ev.event_id as string,
        eventType: ev.event_type as string,
        outcome: (ev.outcome as string) ?? "",
        amountPaise: (ev.amount_paise as number | null) ?? null,
        receivedAt: ev.received_at as string,
        processedAt: (ev.processed_at as string | null) ?? null,
      };
    }),
  };
}

export interface BookingPage {
  rows: BookingRow[];
  total: number;
  page: number;
  pageSize: number;
  includeContact: boolean;
}

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

/** One page of the booking list — search, filters, paging and count in SQL. */
export async function listBookings(query: BookingQuery): Promise<Result<BookingPage>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<BookingPage>;

  try {
    const rows = await rpc<SearchRow>("admin_search_bookings", {
      ...filterArgs(query),
      p_include_contact: true,
      p_limit: BOOKING_PAGE_SIZE,
      p_offset: bookingOffset(query.page),
    });

    return ok({
      rows: rows.map(mapBookingRow),
      total: rows[0]?.total_count ?? 0,
      page: query.page,
      pageSize: BOOKING_PAGE_SIZE,
      includeContact: true,
    });
  } catch (error) {
    return dbFailure("admin_search_bookings", error) as Result<BookingPage>;
  }
}

/** Every booking matching the filters, for the CSV export (capped). */
export async function collectBookingsForExport(
  query: BookingQuery,
  maxRows: number = EXPORT_MAX_ROWS,
): Promise<Result<{ rows: BookingRow[]; includeContact: boolean; truncated: boolean }>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<{ rows: BookingRow[]; includeContact: boolean; truncated: boolean }>;

  const rows: BookingRow[] = [];
  let offset = 0;
  let total = 0;

  try {
    for (;;) {
      const batch = await rpc<SearchRow>("admin_search_bookings", {
        ...filterArgs(query),
        p_include_contact: true,
        p_limit: EXPORT_BATCH_SIZE,
        p_offset: offset,
      });

      total = batch[0]?.total_count ?? total;
      rows.push(...batch.map(mapBookingRow));
      offset += batch.length;

      if (batch.length < EXPORT_BATCH_SIZE || rows.length >= maxRows) {
        break;
      }
    }
  } catch (error) {
    return dbFailure("booking export", error) as Result<{ rows: BookingRow[]; includeContact: boolean; truncated: boolean }>;
  }

  return ok({
    rows: rows.slice(0, maxRows),
    includeContact: true,
    truncated: rows.length < total,
  });
}

/** One booking in full, by reference / pass id / payment id / order id. */
export async function getBookingDetail(lookup: unknown): Promise<Result<BookingDetail | null>> {
  const term = normaliseSearchTerm(lookup);

  if (!term) {
    return ok(null);
  }

  const notReady = ensureDb();
  if (notReady) return notReady as Result<BookingDetail | null>;

  try {
    const rows = await rpc<DetailRow>("admin_booking_detail", {
      p_lookup: term,
      p_include_contact: true,
    });
    const [row] = rows;
    return ok(row ? mapDetail(row) : null);
  } catch (error) {
    return dbFailure("admin_booking_detail", error) as Result<BookingDetail | null>;
  }
}

/** The pass categories the filter bar offers. */
export async function listBookingPassOptions(): Promise<Result<FilterOption[]>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<FilterOption[]>;

  try {
    const data = await sql<{
      id: string;
      name: string;
      price_inr: number;
      is_active: boolean;
      sort_order: number;
    }[]>`
      select id, name, price_inr, is_active, sort_order
      from public.pass_categories
      order by sort_order asc, price_inr asc
      limit 50
    `;

    return ok(
      data.map((row) => ({
        value: row.id,
        label: row.is_active ? row.name : `${row.name} (retired)`,
      })),
    );
  } catch (error) {
    // The filter bar is not the page: without it, search still works.
    if (error instanceof DatabaseError) {
      console.error("[admin] pass_categories read failed:", error.message);
    }
    return ok([]);
  }
}

// -----------------------------------------------------------------------------
// Event settings
// -----------------------------------------------------------------------------

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
  whatsappNumber: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  youtubeUrl: string | null;
  supportHours: string[];
  currency: string;
}

/** The event row the public site reads — what "settings" means today. */
export async function getEventSettings(): Promise<Result<EventSettings | null>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<EventSettings | null>;

  try {
    const data = await sql<{
      name: string;
      slug: string;
      status: string;
      tagline: string | null;
      venue_name: string;
      venue_address: string | null;
      city: string;
      state: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      whatsapp_number: string | null;
      instagram_url: string | null;
      facebook_url: string | null;
      youtube_url: string | null;
      support_hours: string[] | null;
      currency: string;
    }[]>`
      select
        name, slug, status, tagline, venue_name, venue_address, city, state,
        contact_phone, contact_email, whatsapp_number, instagram_url,
        facebook_url, youtube_url, support_hours, currency
      from public.events
      order by created_at asc
      limit 1
    `;

    const row = data[0];
    if (!row) {
      return ok(null);
    }

    return ok({
      name: row.name,
      slug: row.slug,
      status: row.status,
      tagline: row.tagline,
      venueName: row.venue_name,
      venueAddress: row.venue_address,
      city: row.city,
      state: row.state,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      whatsappNumber: row.whatsapp_number,
      instagramUrl: row.instagram_url,
      facebookUrl: row.facebook_url,
      youtubeUrl: row.youtube_url,
      supportHours: row.support_hours ?? [],
      currency: row.currency,
    });
  } catch (error) {
    return dbFailure("event settings", error) as Result<EventSettings | null>;
  }
}
