import type { NextResponse } from "next/server";

import { noStoreJson, statusForBookingError } from "@/lib/booking/http";
import { bookingLimiter, clientKeyFrom } from "@/lib/rate-limit";
import { createPendingBooking } from "@/lib/services/bookings";
import type { BookingApiResponse } from "@/types/booking";

/**
 * Booking creation endpoint.
 *
 * The only way a booking enters the system: it validates the payload, then calls
 * the `create_pending_booking()` database function with the service role. Prices,
 * the admitted head count and capacity are all decided in Postgres — the request
 * body cannot contain an amount.
 *
 * Only POST is exported, so there is no endpoint that lists or reads bookings
 * (booking data belongs to the admin screens and is protected by RLS).
 *
 * A fixed-window limiter stands in front of the work (see `src/lib/rate-limit.ts`
 * for what that is and, more importantly, for what actually protects the database:
 * capacity is counted from *paid* bookings, so holding a night off sale by flooding
 * this endpoint is not possible).
 */
export const runtime = "nodejs";

// Never cached: the response depends on live capacity.
export const dynamic = "force-dynamic";

/** A booking payload is a few hundred bytes; anything bigger is not a booking. */
const MAX_BODY_BYTES = 4_096;

export async function POST(request: Request): Promise<NextResponse<BookingApiResponse>> {
  const limit = bookingLimiter.check(clientKeyFrom(request.headers));

  if (!limit.allowed) {
    return json(
      {
        ok: false,
        error: {
          kind: "rate-limited",
          message: "That is a lot of booking attempts in a row. Please wait a minute and try again.",
        },
      },
      429,
      // What a well-behaved client (and a proxy) should respect.
      { "retry-after": String(limit.retryAfterSeconds) },
    );
  }

  const raw = await request.text();

  if (raw.length > MAX_BODY_BYTES) {
    return json(
      {
        ok: false,
        error: { kind: "invalid-input", message: "That request was too large to be a booking." },
      },
      413,
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return json(
      {
        ok: false,
        error: { kind: "invalid-input", message: "Send the booking details as JSON." },
      },
      400,
    );
  }

  const result = await createPendingBooking(payload);

  if (result.ok) {
    return json({ ok: true, booking: result.booking }, 201);
  }

  return json({ ok: false, error: result.error }, statusForBookingError(result.error.kind));
}

function json(
  body: BookingApiResponse,
  status: number,
  headers?: Record<string, string>,
): NextResponse<BookingApiResponse> {
  return noStoreJson(body, status, headers);
}
