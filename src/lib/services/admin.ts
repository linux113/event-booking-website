import "server-only";

import { isSupabaseConfigured } from "@/config/env";
import { can, ROLE_LABELS, type StaffRole } from "@/lib/auth/permissions";
import { fail, ok, type Result, type ServiceError } from "@/lib/services/result";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads for the admin area — server side only.
 *
 * Three rules shape this module:
 *
 *   1. **The database counts and filters, not the app.** `admin_lookup_bookings()`
 *      and `admin_dashboard_stats()` are `service_role`-only functions, so the admin
 *      area never pulls a table into Node to add it up, and an unsupported filter can
 *      never quietly widen a result set.
 *   2. **A role decides the *shape* of the data, not just the door.** The staff view
 *      is requested with `p_include_contact = false`, so contact details, amounts and
 *      gateway ids are never returned at all. Redaction that happens upstream of the
 *      component cannot be forgotten by a component.
 *   3. **No service-role key ever leaves the server.** Everything here runs on the
 *      server and returns plain objects; the browser gets rendered HTML.
 */

const NOT_CONFIGURED: ServiceError = {
  kind: "not-configured",
  message: "The admin area needs the database: add the Supabase variables and try again.",
};

function getAdminClient(): { ok: true; client: SupabaseClient<Database> } | { ok: false; error: ServiceError } {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: NOT_CONFIGURED };
  }

  try {
    return { ok: true, client: createSupabaseAdminClient() };
  } catch (error) {
    console.error("[admin] admin client unavailable:", error);

    return { ok: false, error: NOT_CONFIGURED };
  }
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

type StatsRow = Database["public"]["Functions"]["admin_dashboard_stats"]["Returns"][number];

export type DashboardStats = StatsRow;

/**
 * Live counts for the dashboard. `today` is the venue's date, computed on the
 * server, so "tonight" means the venue's tonight rather than UTC's.
 */
export async function getDashboardStats(today: string): Promise<Result<DashboardStats | null>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client.rpc("admin_dashboard_stats", { p_today: today });

  if (error) {
    console.error("[admin] admin_dashboard_stats failed:", error.message, error.code);

    return fail("query-failed", "We could not load the dashboard numbers right now.");
  }

  const [row] = Array.isArray(data) ? data : [];

  return ok(row ?? null);
}

// -----------------------------------------------------------------------------
// Booking lookup
// -----------------------------------------------------------------------------

type LookupRow = Database["public"]["Functions"]["admin_lookup_bookings"]["Returns"][number];

/**
 * One booking as the admin list renders it.
 *
 * The contact fields and the amount are nullable for a reason: for a staff member
 * they are *absent*, not hidden, and the UI has nothing to accidentally render.
 */
export interface AdminBookingRow {
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
  createdAt: string;
  passesIssued: number;
  passesCheckedIn: number;
  checkInTimes: string[];
}

function mapRow(row: LookupRow): AdminBookingRow {
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
    createdAt: row.created_at,
    passesIssued: row.passes_issued,
    passesCheckedIn: row.passes_checked_in,
    checkInTimes: Array.isArray(row.check_in_times) ? row.check_in_times : [],
  };
}

export interface BookingLookup {
  /** The trimmed term that was searched for (echoed back to the page). */
  query: string;
  /** False for roles without `bookings:view_contact` — the limited view. */
  includeContact: boolean;
  rows: AdminBookingRow[];
}

/** The shortest search worth running. A single letter matches half the event. */
export const MIN_LOOKUP_LENGTH = 3;

/**
 * Find bookings by reference, mobile number or guest name.
 *
 * The `role` decides whether the contact columns exist in the response at all (see
 * `permissions.ts` for why that is a separate capability from opening the page).
 */
export async function lookupBookings(
  query: unknown,
  role: StaffRole,
  limit = 25,
): Promise<Result<BookingLookup | null>> {
  const term = typeof query === "string" ? query.trim().slice(0, 64) : "";
  const includeContact = can(role, "bookings:view_contact");

  if (term.length < MIN_LOOKUP_LENGTH) {
    // Not an error: an empty search box is a page with instructions on it.
    return ok(null);
  }

  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client.rpc("admin_lookup_bookings", {
    p_query: term,
    p_include_contact: includeContact,
    p_limit: limit,
  });

  if (error) {
    console.error("[admin] admin_lookup_bookings failed:", error.message, error.code);

    return fail("query-failed", "We could not search bookings right now.");
  }

  return ok({
    query: term,
    includeContact,
    rows: (Array.isArray(data) ? data : []).map(mapRow),
  });
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
