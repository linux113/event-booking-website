import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  getRazorpayApiBaseUrl,
  getRazorpayKeyId,
  getRazorpayKeySecret,
  getRazorpayWebhookSecret,
  isLiveRazorpayAllowed,
  isRazorpayConfigured,
} from "@/config/env";
import { razorpayKeyIssue } from "@/lib/payments/mode";

/**
 * Razorpay REST client and signature verification — **server only**.
 *
 * No SDK: the three calls this project needs (create an order, read a payment,
 * verify a signature) are plain HTTPS requests and two HMACs, which keeps the
 * dependency surface — and the amount of code holding the key secret — small.
 *
 * The secret never leaves this module: it is read from a non-`NEXT_PUBLIC_`
 * variable, used for Basic auth and HMACs, and `import "server-only"` makes the
 * build fail if this file is ever pulled into client code.
 */

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
};

export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** `created` | `authorized` | `captured` | `refunded` | `failed` */
  status: string;
  method: string | null;
};

export type RazorpayFailureKind =
  | "not-configured"
  /** A live key was configured while live mode is disabled. */
  | "live-key-blocked"
  | "api-error";

export type RazorpayResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: RazorpayFailureKind; message: string };

const REQUEST_TIMEOUT_MS = 10_000;

export function isPaymentGatewayConfigured(): boolean {
  return isRazorpayConfigured();
}

/**
 * True when the site can actually take a payment: keys are present **and** the key
 * is usable (a live key without `RAZORPAY_ALLOW_LIVE` is not).
 *
 * Pages use this instead of `isRazorpayConfigured()` so a deployment that carries
 * live keys with live mode switched off does not advertise a checkout it would
 * refuse — it falls back to the organiser-handled copy and writes nothing.
 */
export function isPaymentGatewayUsable(): boolean {
  return isPaymentGatewayConfigured() && getRazorpayKeyProblem() === null;
}

/** The public key id, safe to hand to the browser. Never the secret. */
export function getPublicKeyId(): string {
  return getRazorpayKeyId();
}

function authorisationHeader(): string {
  const credentials = `${getRazorpayKeyId()}:${getRazorpayKeySecret()}`;

  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

/**
 * Blocks live keys unless live mode was switched on deliberately.
 *
 * Exported so the payment service can refuse a request before it writes anything:
 * a deployment accidentally carrying live keys must not even create a pending row.
 */
export function getRazorpayKeyProblem(): string | null {
  try {
    return razorpayKeyIssue(getRazorpayKeyId(), isLiveRazorpayAllowed());
  } catch {
    return "No Razorpay key id is configured.";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<RazorpayResult<T>> {
  if (!isRazorpayConfigured()) {
    return {
      ok: false,
      kind: "not-configured",
      message: "Payments are not configured on this server.",
    };
  }

  const problem = getRazorpayKeyProblem();

  if (problem) {
    console.error(`[payments] refusing to call Razorpay: ${problem}`);

    return { ok: false, kind: "live-key-blocked", message: problem };
  }

  try {
    const response = await fetch(`${getRazorpayApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        authorization: authorisationHeader(),
        "content-type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: { description?: string; code?: string } })
      | null;

    if (!response.ok) {
      const description = payload?.error?.description ?? `Razorpay responded ${response.status}`;

      console.error(`[payments] Razorpay ${path} failed: ${response.status} ${description}`);

      return { ok: false, kind: "api-error", message: "The payment gateway rejected the request." };
    }

    if (!payload) {
      return { ok: false, kind: "api-error", message: "The payment gateway returned an empty response." };
    }

    return { ok: true, data: payload };
  } catch (error) {
    console.error("[payments] Razorpay request failed:", error);

    return { ok: false, kind: "api-error", message: "We could not reach the payment gateway." };
  }
}

/**
 * Creates an order for exactly `amountPaise`. The amount always comes from the
 * booking row in the database, never from a request body.
 */
export async function createRazorpayOrder(input: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayResult<RazorpayOrder>> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    return { ok: false, kind: "api-error", message: "Refusing to create an order for a non-positive amount." };
  }

  const result = await request<RazorpayOrder>("/v1/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      // Capture immediately: this project has no separate capture step yet.
      payment_capture: 1,
    }),
  });

  return result;
}

/** Reads a payment back from Razorpay — the server's own source of truth. */
export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayResult<RazorpayPayment>> {
  return request<RazorpayPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

/** Constant-time string comparison that never throws on length mismatch. */
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");

  if (a.length !== b.length || a.length === 0) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

/**
 * Verifies the signature Razorpay Checkout returns to the browser:
 * `HMAC_SHA256("<order_id>|<payment_id>", key_secret)`.
 */
export function verifyCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!input.orderId || !input.paymentId || !input.signature) {
    return false;
  }

  try {
    return safeEqual(hmac(getRazorpayKeySecret(), `${input.orderId}|${input.paymentId}`), input.signature);
  } catch (error) {
    console.error("[payments] checkout signature check failed:", error);
    return false;
  }
}

/**
 * Verifies a webhook signature: `HMAC_SHA256(rawRequestBody, webhook_secret)`.
 * The raw body must be the exact bytes Razorpay signed, which is why the route
 * reads the request as text instead of parsing JSON first.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!rawBody || !signature) {
    return false;
  }

  try {
    return safeEqual(hmac(getRazorpayWebhookSecret(), rawBody), signature);
  } catch (error) {
    console.error("[payments] webhook signature check failed:", error);
    return false;
  }
}
