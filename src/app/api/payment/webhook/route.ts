import { createHash } from "node:crypto";

import type { NextRequest } from "next/server";

import { noStoreJson } from "@/lib/booking/http";
import { isPaymentGatewayConfigured, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { applyWebhookEvent } from "@/lib/services/payments";

/**
 * POST /api/payment/webhook
 *
 * Razorpay's own notification that something happened to a payment. This is the
 * safety net for a customer who closes the browser mid-payment: the booking is
 * confirmed here even though no browser ever called /api/payment/verify.
 *
 * Three protections, in this order:
 *   1. the signature over the **raw** body is verified with RAZORPAY_WEBHOOK_SECRET
 *      (the body is read as text, because a re-serialised JSON body would no longer
 *      match the signature);
 *   2. every delivery is claimed once in `public.payment_events` by its unique id,
 *      so Razorpay's retries cannot confirm a booking twice or issue a second set
 *      of passes;
 *   3. only a server-side database function may change payment_status.
 *
 * Razorpay retries anything that is not a 2xx, so a database failure returns 500
 * on purpose: the retry will either apply the event or report it as a duplicate.
 * An invalid signature returns 400 and is never retried.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

type WebhookPayload = {
  event?: unknown;
  payload?: {
    payment?: { entity?: Record<string, unknown> };
    order?: { entity?: Record<string, unknown> };
    refund?: { entity?: Record<string, unknown> };
  };
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Pulls the order, payment and amount out of whichever entity this event carries. */
function readEntities(body: WebhookPayload): {
  orderId: string | null;
  paymentId: string | null;
  amountPaise: number | null;
} {
  const payment = asRecord(body.payload?.payment?.entity);
  const order = asRecord(body.payload?.order?.entity);
  const refund = asRecord(body.payload?.refund?.entity);

  // `order.paid` only carries the order, so the amount comes from amount_paid.
  const amountPaise =
    asInteger(payment?.amount) ?? asInteger(order?.amount_paid) ?? asInteger(order?.amount) ?? asInteger(refund?.amount);

  return {
    orderId: asString(payment?.order_id) ?? asString(order?.id),
    // `payment.refunded` carries the payment entity, whose id is the payment id.
    paymentId: asString(payment?.id) ?? asString(refund?.payment_id),
    amountPaise,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return noStoreJson({ ok: false, error: "webhook_too_large" }, 413);
  }

  if (!isPaymentGatewayConfigured()) {
    console.error("[payments] webhook received but Razorpay is not configured on this server");

    return noStoreJson({ ok: false, error: "not-configured" }, 503);
  }

  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error("[payments] rejected a webhook with an invalid signature");

    return noStoreJson({ ok: false, error: "invalid-signature" }, 400);
  }

  let body: WebhookPayload;

  try {
    body = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return noStoreJson({ ok: false, error: "invalid-payload" }, 400);
  }

  const eventType = asString(body.event);

  if (!eventType) {
    return noStoreJson({ ok: false, error: "invalid-payload" }, 400);
  }

  // Razorpay sends x-razorpay-event-id; falling back to a hash of the signed body
  // keeps deduplication working for deliveries that do not carry one.
  const eventId =
    asString(request.headers.get("x-razorpay-event-id")) ??
    createHash("sha256").update(rawBody, "utf8").digest("hex");

  const { orderId, paymentId, amountPaise } = readEntities(body);
  const result = await applyWebhookEvent({ eventId, eventType, orderId, paymentId, amountPaise });

  if (!result.ok) {
    // A server without database credentials is a permanent misconfiguration, not a
    // delivery to retry: 503 says so without implying the event was bad.
    const status = result.error.kind === "not-configured" ? 503 : 500;

    return noStoreJson({ ok: false, error: result.error.kind === "not-configured" ? "not-configured" : "processing-failed" }, status);
  }

  if (!result.duplicate) {
    console.info(
      `[payments] ${eventType} → ${result.outcome}${result.reference ? ` (${result.reference})` : ""}`,
    );
  }

  // 200 for duplicates as well: Razorpay must stop retrying a delivery that has
  // already been applied.
  return noStoreJson(
    { ok: true, event: eventType, outcome: result.outcome, duplicate: result.duplicate },
    200,
  );
}
