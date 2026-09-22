import "server-only";

import { validateBookingRequest } from "@/lib/booking/validation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/config/env";
import type {
  BookingApiError,
  BookingFieldErrors,
  BookingRequestInput,
  CreatedBooking,
} from "@/types/booking";

/**
 * Booking creation — server side only.
 *
 * The browser posts identifiers and contact details; **no price is accepted from
 * anyone**. This module validates the payload, then calls
 * `public.create_pending_booking()` with the service role. That function locks the
 * night, re-reads capacity, reads the price from `pass_categories` and writes the
 * booking, so the amounts returned here are the database's, not the client's.
 *
 * The booking is created `pending` / `unpaid`. Payment is a later step: nothing in
 * this module can mark a booking as paid.
 *
 * Unlike the read services, this returns the API error shape (`BookingApiError`)
 * because the checkout form needs per-field messages; it still never throws.
 */

export type CreateBookingResult =
  | { ok: true; booking: CreatedBooking; input: BookingRequestInput }
  | { ok: false; error: BookingApiError };

const NOT_CONFIGURED: BookingApiError = {
  kind: "not-configured",
  message: "Booking is temporarily unavailable: the server is not connected to the database.",
};

const SERVER_ERROR: BookingApiError = {
  kind: "server-error",
  message: "We could not create the booking just now. Please try again in a moment.",
};

/**
 * SQLSTATE -> what the customer should read. The codes are raised by
 * `create_pending_booking()` and documented in the migration.
 */
const FIELD_BY_CODE: Record<string, keyof BookingFieldErrors> = {
  PB001: "quantity",
  PB002: "eventDateId",
  PB003: "passCategoryId",
  PB004: "quantity",
  PB005: "numberOfPeople",
  PB006: "eventDateId",
};

export async function createPendingBooking(payload: unknown): Promise<CreateBookingResult> {
  const validated = validateBookingRequest(payload);

  if (!validated.ok) {
    const hasFields = Object.keys(validated.fieldErrors).length > 0;

    return {
      ok: false,
      error: {
        kind: "invalid-input",
        message: validated.message ?? "Please check the highlighted fields and try again.",
        fieldErrors: hasFields ? validated.fieldErrors : undefined,
      },
    };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: NOT_CONFIGURED };
  }

  const input = validated.value;

  let client;

  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    console.error("[bookings] admin client unavailable:", error);
    return { ok: false, error: NOT_CONFIGURED };
  }

  const args = {
    p_event_id: input.eventId,
    p_event_date_id: input.eventDateId,
    p_pass_category_id: input.passCategoryId,
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_customer_email: input.customerEmail,
    p_quantity: input.quantity,
    p_number_of_people: input.numberOfPeople,
    p_idempotency_key: input.idempotencyKey,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await client.rpc("create_pending_booking", args);

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;

      if (!row) {
        console.error("[bookings] create_pending_booking returned no row");
        return { ok: false, error: SERVER_ERROR };
      }

      return { ok: true, booking: mapBooking(row), input };
    }

    // Two requests raced with the same idempotency key: the second one hits the
    // unique index. Re-running the function returns the booking the first one
    // created, which is exactly what a retry should get.
    if (error.code === "23505" && attempt === 0) {
      continue;
    }

    return { ok: false, error: mapDatabaseError(error) };
  }

  return { ok: false, error: SERVER_ERROR };
}

function mapDatabaseError(error: { code?: string | null; message: string; details?: string | null }): BookingApiError {
  const code = error.code ?? "";
  const field = FIELD_BY_CODE[code];
  const detail = parseDetail(error.details);

  console.error(`[bookings] create_pending_booking failed: ${code || "unknown"} ${error.message}`);

  switch (code) {
    case "PB001": {
      return unavailable(
        detail === null
          ? "This night does not have enough places left for your booking."
          : `This night only has ${detail} ${detail === 1 ? "place" : "places"} left, so this booking cannot be confirmed.`,
        field,
      );
    }
    case "PB002":
      return unavailable("This night is no longer open for booking.", field);
    case "PB003":
      return unavailable("That pass type is not on sale right now.", field);
    case "PB006":
      return unavailable("That night could not be found. Please pick a night again.", field);
    case "PB004":
      return invalid(
        detail === null
          ? "Choose a whole number of passes within the limit for this pass type."
          : `This pass type can be booked up to ${detail} at a time.`,
        field,
      );
    case "PB005":
      return invalid(
        detail === null
          ? "The number of people does not match this pass type."
          : `This booking admits exactly ${detail} people — adjust the quantity or the head count.`,
        field,
      );
    default:
      return SERVER_ERROR;
  }
}

function unavailable(message: string, field?: keyof BookingFieldErrors): BookingApiError {
  return { kind: "unavailable", message, fieldErrors: field ? { [field]: message } : undefined };
}

function invalid(message: string, field?: keyof BookingFieldErrors): BookingApiError {
  return { kind: "invalid-input", message, fieldErrors: field ? { [field]: message } : undefined };
}

/** `details` carries the number the customer needs (places left, limit, head count). */
function parseDetail(details: string | null | undefined): number | null {
  if (!details) {
    return null;
  }

  const value = Number(details.trim());

  return Number.isInteger(value) && value >= 0 ? value : null;
}

type BookingRow = {
  booking_uuid: string;
  booking_reference: string;
  public_token: string;
  booking_status: string;
  payment_status: string;
  quantity: number;
  number_of_people: number;
  subtotal: number;
  total_amount: number;
  event_id: string;
  event_date_id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  pass_category_id: string;
  pass_name: string;
  pass_composition: string | null;
  currency: string;
  razorpay_order_id: string | null;
  created_at: string;
  was_existing: boolean;
};

function mapBooking(row: BookingRow): CreatedBooking {
  return {
    id: row.booking_uuid,
    reference: row.booking_reference,
    status: row.booking_status as CreatedBooking["status"],
    paymentStatus: row.payment_status as CreatedBooking["paymentStatus"],
    quantity: row.quantity,
    numberOfPeople: row.number_of_people,
    subtotal: row.subtotal,
    totalAmount: row.total_amount,
    eventId: row.event_id,
    eventDateId: row.event_date_id,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    passCategoryId: row.pass_category_id,
    passName: row.pass_name,
    passComposition: row.pass_composition,
    currency: row.currency,
    publicToken: row.public_token,
    razorpayOrderId: row.razorpay_order_id,
    createdAt: row.created_at,
    reusedExisting: row.was_existing,
  };
}
