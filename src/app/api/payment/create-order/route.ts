import type { NextRequest } from "next/server";

import { noStoreJson, statusForBookingError } from "@/lib/booking/http";
import { clientKeyFrom, paymentOrderLimiter } from "@/lib/rate-limit";
import { createPaymentOrder } from "@/lib/services/payments";
import type { PaymentOrderApiResponse } from "@/types/booking";

/**
 * POST /api/payment/create-order
 *
 * Receives the booking request, creates the pending booking (or reuses the one
 * this browser already made), asks Razorpay for an order for the amount the
 * database fixed, and returns what the browser needs to open Checkout: the order
 * id, the public key id and the amount — never a secret, and never a price the
 * client sent.
 *
 * Limited per address per window, because every call that passes validation creates
 * a pending booking and asks Razorpay for an order (see `src/lib/rate-limit.ts`).
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

export async function POST(request: NextRequest): Promise<Response> {
  const limit = paymentOrderLimiter.check(clientKeyFrom(request.headers));

  if (!limit.allowed) {
    return noStoreJson<PaymentOrderApiResponse>(
      {
        ok: false,
        error: {
          kind: "rate-limited",
          message: "That is a lot of payment attempts in a row. Please wait a minute and try again.",
        },
      },
      429,
      { "retry-after": String(limit.retryAfterSeconds) },
    );
  }

  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return noStoreJson<PaymentOrderApiResponse>(
      { ok: false, error: { kind: "invalid-input", message: "That request was too large." } },
      413,
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return noStoreJson<PaymentOrderApiResponse>(
      { ok: false, error: { kind: "invalid-input", message: "Send the booking details as JSON." } },
      400,
    );
  }

  const result = await createPaymentOrder(payload);

  if (!result.ok) {
    return noStoreJson<PaymentOrderApiResponse>(
      { ok: false, error: result.error },
      statusForBookingError(result.error.kind),
    );
  }

  return noStoreJson<PaymentOrderApiResponse>({ ok: true, order: result.order }, 201);
}
