import "server-only";

import { refusalFromDatabase } from "@/lib/admin/catalogue";
import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc } from "@/lib/db/client";
import { fail, ok, type Result } from "@/lib/services/result";
import type { AdminNight, AdminPassType, CatalogueError, CatalogueResult } from "@/types/catalogue";

/**
 * The management screens' data access: the pass catalogue and the nights.
 *
 * Every change goes through a narrow `service_role` function
 * (`admin_save_pass_category`, `admin_set_event_date_capacity`, …) which
 * re-validates what it receives and takes the locks it needs. A refusal is data:
 * the SQLSTATE becomes the field to highlight, not a thrown exception.
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

function toDbError(error: unknown): DatabaseError {
  return error instanceof DatabaseError ? error : new DatabaseError(String(error));
}

/** Every pass type of the event, on sale or not, with what has been sold on it. */
export async function listPassTypes(): Promise<Result<AdminPassType[]>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<AdminPassType[]>;

  try {
    const data = await rpc<PassCatalogueRow>("admin_pass_catalogue", {});
    return ok((data ?? []).map(toPassType));
  } catch (error) {
    return dbFailure("pass catalogue", error) as Result<AdminPassType[]>;
  }
}

/** Every night of the event, with what is on sale and what is left. */
export async function listAdminNights(): Promise<Result<AdminNight[]>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<AdminNight[]>;

  try {
    const data = await rpc<DateRow>("admin_event_dates", {});
    return ok((data ?? []).map(toNight));
  } catch (error) {
    return dbFailure("event dates", error) as Result<AdminNight[]>;
  }
}

export type WriteOutcome<T> = CatalogueResult<T>;

function saved<T>(data: T): WriteOutcome<T> {
  return { ok: true, data };
}

function notConfigured<T>(): WriteOutcome<T> {
  return {
    ok: false,
    error: {
      kind: "not-configured",
      message: "The database is not connected yet, so nothing can be saved. Add DATABASE_URL.",
    },
  };
}

function refused<T>(context: string, error: unknown): WriteOutcome<T> {
  const dbError = toDbError(error);
  console.error(`[admin] ${context} refused:`, dbError.message, dbError.code ?? "", dbError.details ?? "");
  return { ok: false, error: refusalFromDatabase({ message: dbError.message, code: dbError.code, details: dbError.details }) };
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

/** Create or edit one pass type. Returns the row as the database now holds it. */
export async function savePassType(input: SavePassInput): Promise<WriteOutcome<AdminPassType>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const data = await rpc<SavedPassRow>("admin_save_pass_category", {
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

    const [row] = data ?? [];

    if (!row || !row.pass_uuid) {
      return {
        ok: false,
        error: { kind: "server-error", message: "The pass was not saved — please try again." },
      };
    }

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
  } catch (error) {
    return refused("save pass", error);
  }
}

/** Take one pass on or off sale, without touching anything else about it. */
export async function setPassActive(
  id: string,
  isActive: boolean,
): Promise<WriteOutcome<{ id: string; isActive: boolean }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const data = await rpc<{ pass_uuid: string; is_active: boolean }>("admin_set_pass_category_active", {
      p_id: id,
      p_is_active: isActive,
    });

    const [row] = data ?? [];

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
  } catch (error) {
    return refused("toggle pass", error);
  }
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
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const data = await rpc<SavedNightRow>("admin_save_event_date", {
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

    const [row] = data ?? [];

    if (!row || !row.date_uuid) {
      return {
        ok: false,
        error: { kind: "server-error", message: "The night was not saved — please try again." },
      };
    }

    const capacity = Number(row.capacity);
    const capacityHeld = Number(row.capacity_held);
    const seatsAvailable = Number(row.seats_available);

    return saved({
      id: row.date_uuid,
      date: row.event_date,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.night_status,
      capacity,
      capacityHeld,
      bookingOpen: row.booking_open,
      notes: row.notes,
      bookedPeople: Number(row.booked_people),
      bookedBookings: 0,
      passesIssued: 0,
      seatsOnSale: capacity - capacityHeld,
      seatsAvailable,
      overCommitted: Number(row.booked_people) + capacityHeld > capacity,
      isFull: seatsAvailable === 0,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    return refused("save night", error);
  }
}

/**
 * Set a night's capacity — and, when asked, how many seats are held back.
 * `capacityHeld` null means "leave the held figure alone".
 */
export async function setNightCapacity(
  id: string,
  capacity: number,
  capacityHeld: number | null,
): Promise<WriteOutcome<{ id: string; capacity: number; capacityHeld: number; seatsAvailable: number }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const data = await rpc<{
      date_uuid: string;
      capacity: number;
      capacity_held: number;
      seats_available: number;
    }>("admin_set_event_date_capacity", {
      p_id: id,
      p_capacity: capacity,
      p_capacity_held: capacityHeld,
    });

    const [row] = data ?? [];

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
  } catch (error) {
    return refused("set capacity", error);
  }
}

/** Open or close booking on one night. */
export async function setNightBookingOpen(
  id: string,
  bookingOpen: boolean,
): Promise<WriteOutcome<{ id: string; bookingOpen: boolean; seatsAvailable: number }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const data = await rpc<{ date_uuid: string; booking_open: boolean; seats_available: number }>(
      "admin_set_event_date_booking",
      {
        p_id: id,
        p_booking_open: bookingOpen,
      },
    );

    const [row] = data ?? [];

    if (!row) {
      return {
        ok: false,
        error: { kind: "server-error", code: "PT007", field: "date", message: "That night no longer exists — reload the page." },
      };
    }

    return saved({ id: row.date_uuid, bookingOpen: row.booking_open, seatsAvailable: Number(row.seats_available) });
  } catch (error) {
    return refused("set booking open", error);
  }
}

export type { CatalogueError };
