import "server-only";

import { refusalFromDatabase } from "@/lib/admin/catalogue";
import { getAdminClient } from "@/lib/services/admin-client";
import { fail, ok, type Result } from "@/lib/services/result";
import type { AdminNight, AdminPassType, CatalogueError, CatalogueResult } from "@/types/catalogue";

/**
 * The management screens' data access: the pass catalogue and the nights.
 *
 * Two rules run through every function here.
 *
 * **Nothing writes a table.** Every change goes through a narrow `service_role`
 * function (`admin_save_pass_category`, `admin_set_event_date_capacity`, …) which
 * re-validates what it receives and takes the locks it needs. A screen cannot, for
 * example, save a price without also passing the name and the code that the same
 * function checks — and the database, not the form, decides whether they are legal.
 *
 * **A refusal is data, not an exception.** The database raises a code (PT004,
 * PC003…); `refusalFromDatabase` turns it into the field to highlight and the
 * sentence to show, so the route handler never has to parse Postgres prose and the
 * caller never sees a SQLSTATE.
 */

interface PassCatalogueRow {
  pass_uuid: string;
  code: string;
  name: string;
  composition: string;
  description: string | null;
  price_inr: number;
  number_of_people: number;
  max_per_booking: number;
  min_age: number;
  is_active: boolean;
  sort_order: number;
  bookings_count: number;
  paid_bookings: number;
  passes_issued: number;
  people_sold: number;
  revenue_inr: number;
  updated_at: string;
}

interface SavedPassRow {
  pass_uuid: string;
  code: string;
  name: string;
  composition: string;
  description: string | null;
  price_inr: number;
  number_of_people: number;
  max_per_booking: number;
  min_age: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface SavedNightRow {
  date_uuid: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  night_status: string;
  capacity: number;
  capacity_held: number;
  booking_open: boolean;
  notes: string | null;
  booked_people: number;
  seats_available: number;
  updated_at: string;
}

interface DateRow {
  date_uuid: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  night_status: string;
  capacity: number;
  capacity_held: number;
  booking_open: boolean;
  notes: string | null;
  booked_people: number;
  booked_bookings: number;
  passes_issued: number;
  seats_on_sale: number;
  seats_available: number;
  over_committed: boolean;
  is_full: boolean;
  updated_at: string;
}

function toPassType(row: PassCatalogueRow): AdminPassType {
  return {
    id: row.pass_uuid,
    code: row.code,
    name: row.name,
    composition: row.composition,
    description: row.description,
    priceInr: row.price_inr,
    numberOfPeople: row.number_of_people,
    maxPerBooking: row.max_per_booking,
    minAge: row.min_age,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    bookingsCount: Number(row.bookings_count),
    paidBookings: Number(row.paid_bookings),
    passesIssued: Number(row.passes_issued),
    peopleSold: Number(row.people_sold),
    revenueInr: Number(row.revenue_inr),
    updatedAt: row.updated_at,
  };
}

function toNight(row: DateRow): AdminNight {
  return {
    id: row.date_uuid,
    date: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.night_status,
    capacity: Number(row.capacity),
    capacityHeld: Number(row.capacity_held),
    bookingOpen: row.booking_open,
    notes: row.notes,
    bookedPeople: Number(row.booked_people),
    bookedBookings: Number(row.booked_bookings),
    passesIssued: Number(row.passes_issued),
    seatsOnSale: Number(row.seats_on_sale),
    seatsAvailable: Number(row.seats_available),
    overCommitted: row.over_committed,
    isFull: row.is_full,
    updatedAt: row.updated_at,
  };
}

/** Every pass type of the event, on sale or not, with what has been sold on it. */
export async function listPassTypes(): Promise<Result<AdminPassType[]>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client.rpc("admin_pass_catalogue", {});

  if (error) {
    console.error("[admin] pass catalogue read failed:", error.message, error.code);

    return fail("query-failed", "We could not load the pass types right now.");
  }

  return ok(((data ?? []) as PassCatalogueRow[]).map(toPassType));
}

/** Every night of the event, with what is on sale and what is left. */
export async function listAdminNights(): Promise<Result<AdminNight[]>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client.rpc("admin_event_dates", {});

  if (error) {
    console.error("[admin] event dates read failed:", error.message, error.code);

    return fail("query-failed", "We could not load the event's nights right now.");
  }

  return ok(((data ?? []) as DateRow[]).map(toNight));
}

/** A write result: the saved row, or the reason it was refused. */
export type WriteOutcome<T> = CatalogueResult<T>;

/**
 * The success half. Spelled out here rather than reusing `ok()` from the read-side
 * result: a write's failures are a different vocabulary — refused by a rule, versus
 * a query that did not run — and conflating the two would let a route report a
 * database refusal as a 500.
 */
function saved<T>(data: T): WriteOutcome<T> {
  return { ok: true, data };
}

function notConfigured<T>(): WriteOutcome<T> {
  return {
    ok: false,
    error: {
      kind: "not-configured",
      message:
        "The database is not connected yet, so nothing can be saved. Add the Supabase keys to the environment.",
    },
  };
}

/** Turn a PostgREST error into a refusal, logging the real one server-side. */
function refused<T>(context: string, error: { message: string; code?: string; details?: string }): WriteOutcome<T> {
  console.error(`[admin] ${context} refused:`, error.message, error.code ?? "", error.details ?? "");

  return { ok: false, error: refusalFromDatabase(error) };
}

export interface SavePassInput {
  id: string | null;
  code: string;
  name: string;
  composition: string;
  description: string;
  priceInr: number;
  numberOfPeople: number;
  maxPerBooking: number;
  minAge: number;
  sortOrder: number;
  isActive: boolean;
}

/**
 * Create or edit one pass type.
 *
 * The return value is the row as the database now holds it — not as it was
 * submitted — so the screen shows the normalised code ("family-pass", not
 * "Family Pass") without a second read.
 */
export async function savePassType(input: SavePassInput): Promise<WriteOutcome<AdminPassType>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_save_pass_category", {
    p_id: input.id,
    p_event_id: null,
    p_code: input.code,
    p_name: input.name,
    p_composition: input.composition,
    p_description: input.description,
    p_price_inr: input.priceInr,
    p_number_of_people: input.numberOfPeople,
    p_max_per_booking: input.maxPerBooking,
    p_min_age: input.minAge,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
  });

  if (error) {
    return refused("save pass", error);
  }

  const [row] = (data ?? []) as SavedPassRow[];

  if (!row || !row.pass_uuid) {
    return {
      ok: false,
      error: { kind: "server-error", message: "The pass was not saved — please try again." },
    };
  }

  // The catalogue numbers (sold, issued, taken) come from a different function, and a
  // freshly saved pass has none of them yet. Rather than a second round trip to learn
  // that, they are zero here — and the page re-reads the catalogue on refresh, so the
  // screen converges on the database's answer within the same interaction.
  return saved(
    toPassType({
      ...row,
      bookings_count: 0,
      paid_bookings: 0,
      passes_issued: 0,
      people_sold: 0,
      revenue_inr: 0,
    }),
  );
}

/** Take one pass on or off sale, without touching anything else about it. */
export async function setPassActive(
  id: string,
  isActive: boolean,
): Promise<WriteOutcome<{ id: string; isActive: boolean }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_set_pass_category_active", {
    p_id: id,
    p_is_active: isActive,
  });

  if (error) {
    return refused("toggle pass", error);
  }

  const [row] = (data ?? []) as { pass_uuid: string; is_active: boolean }[];

  if (!row) {
    return {
      ok: false,
      error: {
        kind: "server-error",
        code: "PC008",
        field: "name",
        message: "That pass no longer exists — reload the page.",
      },
    };
  }

  return saved({ id: row.pass_uuid, isActive: row.is_active });
}

export interface SaveNightInput {
  id: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  capacity: number;
  capacityHeld: number;
  status: string;
  bookingOpen: boolean;
  notes: string;
}

/** Create or edit one night. */
export async function saveNight(input: SaveNightInput): Promise<WriteOutcome<AdminNight>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_save_event_date", {
    p_id: input.id,
    p_event_id: null,
    p_event_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_capacity: input.capacity,
    p_capacity_held: input.capacityHeld,
    p_status: input.status,
    p_booking_open: input.bookingOpen,
    p_notes: input.notes,
  });

  if (error) {
    return refused("save night", error);
  }

  const [row] = (data ?? []) as SavedNightRow[];

  if (!row || !row.date_uuid) {
    return {
      ok: false,
      error: { kind: "server-error", message: "The night was not saved — please try again." },
    };
  }

  // The save function returns the night as it now stands, with the seat arithmetic
  // that matters most: what is left. The two flags below are derived the same way
  // `admin_event_dates` derives them, so a saved row and a re-read row agree.
  return saved({
    id: row.date_uuid,
    date: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.night_status,
    capacity: Number(row.capacity),
    capacityHeld: Number(row.capacity_held),
    bookingOpen: row.booking_open,
    notes: row.notes,
    bookedPeople: Number(row.booked_people),
    bookedBookings: 0,
    passesIssued: 0,
    seatsOnSale: Number(row.capacity) - Number(row.capacity_held),
    seatsAvailable: Number(row.seats_available),
    overCommitted: Number(row.booked_people) + Number(row.capacity_held) > Number(row.capacity),
    isFull: Number(row.seats_available) === 0,
    updatedAt: row.updated_at,
  });
}

/**
 * Set a night's capacity — and, when asked, how many seats are held back.
 *
 * `capacityHeld` is nullable on purpose: the quick control on the dates screen only
 * sends a new capacity, and passing null means "leave the held figure alone" rather
 * than "hold nothing back".
 */
export async function setNightCapacity(
  id: string,
  capacity: number,
  capacityHeld: number | null,
): Promise<WriteOutcome<{ id: string; capacity: number; capacityHeld: number; seatsAvailable: number }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_set_event_date_capacity", {
    p_id: id,
    p_capacity: capacity,
    p_capacity_held: capacityHeld,
  });

  if (error) {
    return refused("set capacity", error);
  }

  const [row] = (data ?? []) as {
    date_uuid: string;
    capacity: number;
    capacity_held: number;
    seats_available: number;
  }[];

  if (!row) {
    return {
      ok: false,
      error: { kind: "server-error", code: "PT007", field: "capacity", message: "That night no longer exists — reload the page." },
    };
  }

  return saved({
    id: row.date_uuid,
    capacity: Number(row.capacity),
    capacityHeld: Number(row.capacity_held),
    seatsAvailable: Number(row.seats_available),
  });
}

/** Open or close booking on one night. */
export async function setNightBookingOpen(
  id: string,
  bookingOpen: boolean,
): Promise<WriteOutcome<{ id: string; bookingOpen: boolean; seatsAvailable: number }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_set_event_date_booking", {
    p_id: id,
    p_booking_open: bookingOpen,
  });

  if (error) {
    return refused("set booking open", error);
  }

  const [row] = (data ?? []) as { date_uuid: string; booking_open: boolean; seats_available: number }[];

  if (!row) {
    return {
      ok: false,
      error: { kind: "server-error", code: "PT007", field: "date", message: "That night no longer exists — reload the page." },
    };
  }

  return saved({
    id: row.date_uuid,
    bookingOpen: row.booking_open,
    seatsAvailable: Number(row.seats_available),
  });
}

/** Re-exported so routes do not need to import two modules to report a refusal. */
export type { CatalogueError };
