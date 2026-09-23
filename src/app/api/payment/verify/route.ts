import type { NextRequest } from "next/server";

import { noStoreJson, statusForBookingError } from "@/lib/booking/http";
import { verifyAndConfirmPayment } from "@/lib/services/payments";
import type { PaymentVerifyApiResponse } from "@/types/booking";

/**
 * POST /api/payment/verify
 *
 * The browser reports the result of Checkout; this handler decides whether to
 * believe it. The Razorpay signature is checked server-side with the key secret,
 * the payment is read back from Razorpay, and only then does
 * `confirm_booking_payment()` set payment_status = paid and booking_status =
 * confirmed. A tampered or unsigned body is rejected and the booking stays
 * pending.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;

export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return noStoreJson<PaymentVerifyApiResponse>(
      { ok: false, error: { kind: "invalid-input", message: "That request was too large." } },
      413,
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return noStoreJson<PaymentVerifyApiResponse>(
      { ok: false, error: { kind: "invalid-input", message: "Send the payment result as JSON." } },
      400,
    );
  }

  const result = await verifyAndConfirmPayment(payload);

  if (!result.ok) {
    return noStoreJson<PaymentVerifyApiResponse>(
      { ok: false, error: result.error },
      statusForBookingError(result.error.kind),
    );
  }

  return noStoreJson<PaymentVerifyApiResponse>({ ok: true, payment: result.payment }, 200);
}
