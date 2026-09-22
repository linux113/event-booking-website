import type { NextRequest } from "next/server";

import { noStoreJson, statusForBookingError } from "@/lib/booking/http";
import { getBookingStatusByToken } from "@/lib/services/payments";
import type { PaymentStatusApiResponse } from "@/types/booking";

/**
 * GET /api/payment/status?token=<public_token>
 *
 * Refresh-safe lookup for the customer's own booking. The token is a random uuid
 * handed out with the confirmation, not the booking reference and not the mobile
 * number, so it cannot be guessed; the response carries the booking's state and
 * deliberately no personal details.
 *
 * The success screen uses this after a reload — including after the razorpay
 * callback, when the POST that confirmed the payment no longer exists.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get("token");
  const result = await getBookingStatusByToken(token);

  if (!result.ok) {
    return noStoreJson<PaymentStatusApiResponse>(
      { ok: false, error: result.error },
      statusForBookingError(result.error.kind),
    );
  }

  return noStoreJson<PaymentStatusApiResponse>({ ok: true, booking: result.booking }, 200);
}
