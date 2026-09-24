import "server-only";

import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc } from "@/lib/db/client";
import { validateBookingRequest } from "@/lib/booking/validation";
import type { BookingApiError, BookingFieldErrors, BookingRequestInput, CreatedBooking } from "@/types/booking";

/**
 * Booking creation — server side only.
 *
 * The browser posts identifiers and contact details; **no price is accepted from
 * anyone**. This module validates the payload, then calls
 * `public.create_pending_booking()`. That function locks the night, re-reads
 * capacity, reads the price from `pass_categories` and writes the booking, so
 * the amounts returned here are the database's, not the client's.
 *
 * The booking is created `pending` / `unpaid`. Nothing here can mark it paid.
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

/** SQLSTATE → what the customer should read (codes raised by create_pending_booking). */
const FIELD_BY_CODE: Record<string, keyof BookingFieldErrors> = {
  PB001: "quantity",
  PB002: "eventDateId",
  PB003: "passCategoryId",
  PB004: "quantity",
  PB005: "numberOfPeople",
  PB006: "eventDateId",
  PB007: "referredBy",
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

  if (!isDatabaseConfigured()) {
    return { ok: false, error: NOT_CONFIGURED };
  }

  const input = validated.value;

  const args = {
    p_event_id: input.eventId,
    p_event_date_id: input.eventDateId,
    p_pass_category_id: input.passCategoryId,
    p_customer_name: input.customerName,
    p_customer_mobile: input.customerMobile,
    p_quantity: input.quantity,
    p_number_of_people: input.numberOfPeople,
    p_idempotency_key: input.idempotencyKey,
    p_referred_by: input.referredBy ?? null,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rows = await rpc<BookingRow>("create_pending_booking", args);
      const row = rows[0];

      if (!row) {
        console.error("[bookings] create_pending_booking returned no row");
        return { ok: false, error: SERVER_ERROR };
      }

      return { ok: true, booking: mapBooking(row), input };
    } catch (error) {
      const dbError =
        error instanceof DatabaseError
          ? error
          : new DatabaseError(String(error));

      // Two requests raced with the same idempotency key: the second hits the
      // unique index. Re-running returns the booking the first one created.
      if ((dbError.code === "23505" || dbError.code === "P0001") && attempt === 0) {
        continue;
      }

      return { ok: false, error: mapDatabaseError(dbError) };
    }
  }

  return { ok: false, error: SERVER_ERROR };
}

function mapDatabaseError(error: DatabaseError): BookingApiError {
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
  referred_by?: string | null;
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
    referredBy: row.referred_by ?? null,
  };
}
