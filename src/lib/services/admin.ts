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
import { DatabaseError, isMissingColumnError, rpc, sql } from "@/lib/db/client";
import { adminHeroImagePreviewUrl } from "@/lib/admin/hero-image";
import { gateNight } from "@/lib/gate/night";
import { fail, ok, type Result } from "@/lib/services/result";
import { parseSiteContentJson, siteContentToJson } from "@/lib/site-content";
import type { SiteContent } from "@/types";
import type {
  EventBasicsSettingsValues,
  EventContactSettingsValues,
  EventSettings,
} from "@/types/event-settings";
import type { CatalogueResult } from "@/types/catalogue";

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
  referred_by: string | null;
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
    referredBy: row.referred_by,
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

interface EventSettingsRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  tagline: string | null;
  description: string | null;
  venue_name: string;
  venue_address: string | null;
  city: string;
  state: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  whatsapp_number: string | null;
  maps_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  youtube_url: string | null;
  support_hours: string[] | null;
  currency: string;
  hero_image_url: string | null;
  hero_image_present: boolean;
  hero_image_byte_size: number | null;
  hero_image_version: string;
}

/** The organiser-edited copy for the admin's selected event row.
 *
 * Soft-falls to the empty override set when the migration has not been applied
 * yet (deployments apply migrations with db:setup), so the settings page and
 * the contact/basics saves keep working before the column exists.
 */
async function getEventSiteContentSoft(): Promise<SiteContent> {
  const rows = await sql<{ site_content: unknown }[]>`
    select site_content
    from public.events
    order by (status = 'published') desc, created_at asc
    limit 1
  `;
  return parseSiteContentJson(rows[0]?.site_content);
}

function toEventSettings(row: EventSettingsRow, siteContent: SiteContent): EventSettings {
  const hasHeroImage = row.hero_image_present || Boolean(row.hero_image_url);

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    tagline: row.tagline,
    description: row.description ?? null,
    siteContent,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    state: row.state,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    whatsappNumber: row.whatsapp_number,
    mapsUrl: row.maps_url,
    instagramUrl: row.instagram_url,
    facebookUrl: row.facebook_url,
    youtubeUrl: row.youtube_url,
    supportHours: row.support_hours ?? [],
    currency: row.currency,
    heroImageUrl: row.hero_image_present
      ? adminHeroImagePreviewUrl(row.id, row.hero_image_version)
      : row.hero_image_url,
    hasHeroImage,
    heroImageByteSize: row.hero_image_byte_size === null ? null : Number(row.hero_image_byte_size),
    heroImageVersion: row.hero_image_version,
  };
}


/**
 * The event settings operate on the same row the admin catalogue uses: the oldest
 * published event, falling back to the oldest row when no event is published.
 * The public site itself reads the oldest published event.
 */
export async function getEventSettings(): Promise<Result<EventSettings | null>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<EventSettings | null>;

  try {
    const data = await sql<EventSettingsRow[]>`
      select
        id, name, slug, status, tagline, description, venue_name, venue_address, city, state,
        contact_phone, contact_email, whatsapp_number, maps_url, instagram_url,
        facebook_url, youtube_url, support_hours, currency, hero_image_url,
        (hero_image_data is not null) as hero_image_present,
        octet_length(hero_image_data)::int as hero_image_byte_size,
        hero_image_version::text as hero_image_version
      from public.events
      order by (status = 'published') desc, created_at asc
      limit 1
    `;

    let siteContent: SiteContent;
    try {
      siteContent = await getEventSiteContentSoft();
    } catch (error) {
      if (isMissingColumnError(error, "site_content")) {
        siteContent = parseSiteContentJson(null);
      } else {
        throw error;
      }
    }

    return ok(data[0] ? toEventSettings(data[0], siteContent) : null);
  } catch (error) {
    return dbFailure("event settings", error) as Result<EventSettings | null>;
  }
}

/** Save the public contact and venue columns for the event selected above. */
export async function saveEventContactSettings(
  values: EventContactSettingsValues,
): Promise<CatalogueResult<EventSettings>> {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      error: {
        kind: "not-configured",
        message: "Event settings need the database connection. Add DATABASE_URL and try again.",
      },
    };
  }

  try {
    const rows = await sql<EventSettingsRow[]>`
      update public.events
      set
        contact_phone = ${values.contactPhone},
        contact_email = ${values.contactEmail},
        whatsapp_number = ${values.whatsappNumber},
        venue_address = ${values.venueAddress},
        maps_url = ${values.mapsUrl},
        instagram_url = ${values.instagramUrl},
        facebook_url = ${values.facebookUrl},
        youtube_url = ${values.youtubeUrl},
        support_hours = ${values.supportHours},
        updated_at = now()
      where id = (
        select id from public.events
        order by (status = 'published') desc, created_at asc
        limit 1
      )
      returning
        id, name, slug, status, tagline, description, venue_name, venue_address, city, state,
        contact_phone, contact_email, whatsapp_number, maps_url, instagram_url,
        facebook_url, youtube_url, support_hours, currency, hero_image_url,
        (hero_image_data is not null) as hero_image_present,
        octet_length(hero_image_data)::int as hero_image_byte_size,
        hero_image_version::text as hero_image_version
    `;

    if (!rows[0]) {
      return {
        ok: false,
        error: { kind: "server-error", message: "There is no event row available to update." },
      };
    }

    let siteContent: SiteContent;
    try {
      siteContent = await getEventSiteContentSoft();
    } catch (error) {
      if (isMissingColumnError(error, "site_content")) {
        siteContent = parseSiteContentJson(null);
      } else {
        throw error;
      }
    }

    return { ok: true, data: toEventSettings(rows[0], siteContent) };
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[admin] event settings save failed:", dbError.message, dbError.code ?? "");

    if (dbError.code === "23514") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          message: "The database refused one of these values. Check the WhatsApp number, social links and support hours.",
        },
      };
    }

    return {
      ok: false,
      error: { kind: "server-error", message: "The event settings could not be saved right now." },
    };
  }
}

/**
 * Save the event basics — name, tagline, description and venue names. The
 * public hero, about sections and per-page details all read these columns, so
 * the organiser edits the event's story in one place.
 */
export async function saveEventBasicsSettings(
  values: EventBasicsSettingsValues,
): Promise<CatalogueResult<EventSettings>> {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      error: {
        kind: "not-configured",
        message: "Event settings need the database connection. Add DATABASE_URL and try again.",
      },
    };
  }

  try {
    const rows = await sql<EventSettingsRow[]>`
      update public.events
      set
        name = ${values.name},
        slug = ${values.slug},
        status = ${values.status},
        tagline = ${values.tagline},
        description = ${values.description},
        venue_name = ${values.venueName},
        city = ${values.city},
        state = ${values.state},
        currency = ${values.currency},
        updated_at = now()
      where id = (
        select id from public.events
        order by (status = 'published') desc, created_at asc
        limit 1
      )
      returning
        id, name, slug, status, tagline, description, venue_name, venue_address, city, state,
        contact_phone, contact_email, whatsapp_number, maps_url, instagram_url,
        facebook_url, youtube_url, support_hours, currency, hero_image_url,
        (hero_image_data is not null) as hero_image_present,
        octet_length(hero_image_data)::int as hero_image_byte_size,
        hero_image_version::text as hero_image_version
    `;

    if (!rows[0]) {
      return {
        ok: false,
        error: { kind: "server-error", message: "There is no event row available to update." },
      };
    }

    let siteContent: SiteContent;
    try {
      siteContent = await getEventSiteContentSoft();
    } catch (error) {
      if (isMissingColumnError(error, "site_content")) {
        siteContent = parseSiteContentJson(null);
      } else {
        throw error;
      }
    }

    return { ok: true, data: toEventSettings(rows[0], siteContent) };
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[admin] event basics save failed:", dbError.message, dbError.code ?? "");

    if (dbError.code === "23505") {
      return {
        ok: false,
        error: { kind: "invalid-input", message: "That slug is already used by another event.", field: "slug" },
      };
    }

    if (dbError.code === "23514") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          message: "The database refused one of these values. The event and venue names cannot be blank, the status must be draft/published/archived and the currency 3 letters.",
        },
      };
    }

    return {
      ok: false,
      error: { kind: "server-error", message: "The event settings could not be saved right now." },
    };
  }
}

/**
 * Save the organiser-edited public copy (About Us, gallery heading, FAQs) as
 * the event row's `site_content` jsonb. Empty fields are stored as null/empty,
 * which the public pages read as "use the built-in default text again".
 */
export async function saveEventSiteContentSettings(
  content: SiteContent,
): Promise<CatalogueResult<EventSettings>> {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      error: {
        kind: "not-configured",
        message: "Event settings need the database connection. Add DATABASE_URL and try again.",
      },
    };
  }

  try {
    const rows = await sql<EventSettingsRow[]>`
      update public.events
      set
        site_content = ${siteContentToJson(content)}::jsonb,
        updated_at = now()
      where id = (
        select id from public.events
        order by (status = 'published') desc, created_at asc
        limit 1
      )
      returning
        id, name, slug, status, tagline, description, venue_name, venue_address, city, state,
        contact_phone, contact_email, whatsapp_number, maps_url, instagram_url,
        facebook_url, youtube_url, support_hours, currency, hero_image_url,
        (hero_image_data is not null) as hero_image_present,
        octet_length(hero_image_data)::int as hero_image_byte_size,
        hero_image_version::text as hero_image_version
    `;

    if (!rows[0]) {
      return {
        ok: false,
        error: { kind: "server-error", message: "There is no event row available to update." },
      };
    }

    let siteContent: SiteContent;
    try {
      siteContent = await getEventSiteContentSoft();
    } catch (error) {
      if (isMissingColumnError(error, "site_content")) {
        siteContent = parseSiteContentJson(null);
      } else {
        throw error;
      }
    }

    return { ok: true, data: toEventSettings(rows[0], siteContent) };
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[admin] site content save failed:", dbError.message, dbError.code ?? "");

    if (isMissingColumnError(dbError, "site_content")) {
      return {
        ok: false,
        error: {
          kind: "server-error",
          message:
            "The database is missing the site_content column. Apply the latest migration (npm run db:setup) and try again.",
        },
      };
    }

    if (dbError.code === "23514") {
      return {
        ok: false,
        error: { kind: "invalid-input", message: "The database refused this content. Keep it under the lengths shown." },
      };
    }

    return {
      ok: false,
      error: { kind: "server-error", message: "The site content could not be saved right now." },
    };
  }
}
