import { NextResponse } from "next/server";

import type { BookingApiError } from "@/types/booking";

/**
 * HTTP plumbing shared by the booking and payment route handlers.
 *
 * The API error kinds are the contract the browser codes against, so the mapping
 * from kind to status code lives in one place:
 *
 *   400 invalid-input        the payload failed validation
 *   404 not-found            the booking or order does not exist
 *   409 unavailable          the night/pass/capacity cannot serve the request
 *   409 already-paid         there is nothing left to collect for this booking
 *   503 not-configured       no database credentials on the server
 *   503 gateway-unavailable  Razorpay is not configured (or a live key was blocked)
 *   500 server-error         anything unexpected
 */
const STATUS_BY_KIND: Record<BookingApiError["kind"], number> = {
  "invalid-input": 400,
  "not-found": 404,
  unavailable: 409,
  "already-paid": 409,
  "not-configured": 503,
  "gateway-unavailable": 503,
  "server-error": 500,
};

export function statusForBookingError(kind: BookingApiError["kind"]): number {
  return STATUS_BY_KIND[kind];
}

/** Never cached: every one of these responses depends on live booking state. */
export function noStoreJson<T>(body: T, status: number): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
