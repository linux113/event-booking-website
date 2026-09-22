import { NextResponse } from "next/server";

import { createPendingBooking } from "@/lib/services/bookings";
import type { BookingApiError, BookingApiResponse } from "@/types/booking";

/**
 * Booking creation endpoint.
 *
 * The only way a booking enters the system: it validates the payload, then calls
 * the `create_pending_booking()` database function with the service role. Prices,
 * the admitted head count and capacity are all decided in Postgres — the request
 * body cannot contain an amount.
 *
 * Only POST is exported, so there is no endpoint that lists or reads bookings
 * (booking data is staff-only and protected by RLS).
 */
export const runtime = "nodejs";

// Never cached: the response depends on live capacity.
export const dynamic = "force-dynamic";

/** A booking payload is a few hundred bytes; anything bigger is not a booking. */
const MAX_BODY_BYTES = 4_096;

const STATUS_BY_KIND: Record<BookingApiError["kind"], number> = {
  "invalid-input": 400,
  unavailable: 409,
  "not-configured": 503,
  "server-error": 500,
};

export async function POST(request: Request): Promise<NextResponse<BookingApiResponse>> {
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

  return json({ ok: false, error: result.error }, STATUS_BY_KIND[result.error.kind]);
}

function json(body: BookingApiResponse, status: number): NextResponse<BookingApiResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
