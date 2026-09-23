import "server-only";

import { formatEventDate } from "@/lib/format";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  getPublicKeyId,
  getRazorpayKeyProblem,
  isPaymentGatewayConfigured,
  verifyCheckoutSignature,
} from "@/lib/payments/razorpay";
import { createPendingBooking } from "@/lib/services/bookings";
import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc } from "@/lib/db/client";
import type {
  BookingApiError,
  BookingStatusView,
  ConfirmedBookingView,
  PaymentConfirmation,
  PaymentOrderView,
} from "@/types/booking";

/**
 * Payment orchestration — server side only. **Razorpay logic unchanged.**
 *
 * The flow is: create (or reuse) the pending booking, ask Razorpay for an order
 * for exactly the amount the database fixed, store the order id on the booking,
 * and hand the browser the minimum it needs to open Checkout. Confirmation is the
 * mirror image: verify the signature, re-read the payment from Razorpay, and only
 * then let the database mark the booking paid and issue its passes.
 *
 * Nothing here trusts a client: the amount comes from `bookings.total_amount`,
 * the payment id is only ever used after a signature check, and `payment_status`
 * can only change inside `confirm_booking_payment()`.
 */

export type CreateOrderResult =
  | { ok: true; order: PaymentOrderView }
  | { ok: false; error: BookingApiError };

export type VerifyPaymentResult =
  | { ok: true; payment: PaymentConfirmation }
  | { ok: false; error: BookingApiError };

const DATABASE_NOT_CONFIGURED: BookingApiError = {
  kind: "not-configured",
  message: "Payments are temporarily unavailable: the server is not connected to the database.",
};

function databaseReady(): boolean {
  return isDatabaseConfigured();
}

const GATEWAY_NOT_CONFIGURED: BookingApiError = {
  kind: "gateway-unavailable",
  message: "Online payment is not configured on this server yet.",
};

const UNVERIFIED: BookingApiError = {
  kind: "invalid-input",
  message:
    "We could not verify that payment with the payment gateway, so the booking is still pending. Nothing has been charged by us.",
};

/** Step 1: booking + Razorpay order. The browser never sends an amount. */
export async function createPaymentOrder(payload: unknown): Promise<CreateOrderResult> {
  // The gateway is checked first: a deployment without usable keys must not even
  // write a pending booking, let alone take a payment it cannot verify.
  if (!isPaymentGatewayConfigured()) {
    return { ok: false, error: GATEWAY_NOT_CONFIGURED };
  }

  const keyProblem = getRazorpayKeyProblem();

  if (keyProblem) {
    console.error(`[payments] refusing to create an order: ${keyProblem}`);

    return { ok: false, error: { kind: "gateway-unavailable", message: keyProblem } };
  }

  const bookingResult = await createPendingBooking(payload);

  if (!bookingResult.ok) {
    return { ok: false, error: bookingResult.error };
  }

  const { booking, input } = bookingResult;

  if (booking.paymentStatus === "paid") {
    return {
      ok: false,
      error: {
        kind: "already-paid",
        message: `Booking ${booking.reference} is already confirmed and paid.`,
      },
    };
  }

  // An order already attached to this booking is reused: retrying a payment must
  // not create a second order for the same booking.
  const orderId =
    booking.razorpayOrderId ??
    (await attachNewOrder(
      booking.id,
      booking.reference,
      booking.currency,
      booking.totalAmount,
      booking.eventDateId,
      booking.passCategoryId,
      booking.quantity,
    ));

  if (typeof orderId !== "string") {
    return { ok: false, error: orderId };
  }

  return {
    ok: true,
    order: {
      orderId,
      // Rupees → paise. The amount is the database's number, not the browser's.
      amountPaise: booking.totalAmount * 100,
      currency: booking.currency,
      keyId: getPublicKeyId(),
      booking: { ...booking, razorpayOrderId: orderId },
      prefill: {
        name: input.customerName,
        contact: input.customerMobile,
      },
      description: `${booking.passName} · ${formatEventDate(booking.eventDate)}`,
    },
  };
}

/** Creates the Razorpay order and stores it on the booking (first one wins). */
async function attachNewOrder(
  bookingId: string,
  reference: string,
  currency: string,
  totalAmount: number,
  eventDateId: string,
  passCategoryId: string,
  quantity: number,
): Promise<string | BookingApiError> {
  if (!isPaymentGatewayConfigured()) {
    return GATEWAY_NOT_CONFIGURED;
  }

  const order = await createRazorpayOrder({
    amountPaise: totalAmount * 100,
    currency,
    receipt: reference,
    notes: {
      booking_reference: reference,
      event_date_id: eventDateId,
      pass_category_id: passCategoryId,
      quantity: String(quantity),
    },
  });

  if (!order.ok) {
    return { kind: "gateway-unavailable", message: order.message };
  }

  if (!databaseReady()) {
    return DATABASE_NOT_CONFIGURED;
  }

  try {
    const rows = await rpc<{ razorpay_order_id: string | null; attached: boolean }>(
      "attach_razorpay_order",
      {
        p_booking_id: bookingId,
        p_razorpay_order_id: order.data.id,
      },
    );

    const attached = rows[0];

    if (!attached?.razorpay_order_id) {
      return { kind: "server-error", message: "We could not start the payment. Please try again." };
    }

    if (!attached.attached) {
      // Another request attached an order first — use that one and leave the extra
      // order unused rather than pointing the booking at an order nobody will pay.
      console.warn(
        `[payments] booking ${reference} already had an order; reusing ${attached.razorpay_order_id}`,
      );
    }

    return attached.razorpay_order_id;
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[payments] could not attach the order to the booking:", dbError.message, dbError.code);
    return { kind: "server-error", message: "We could not start the payment. Please try again." };
  }
}

/**
 * Step 2: verify the payment **on the server** and confirm the booking.
 *
 * Three gates, in order: the checkout signature (key secret), the payment read
 * back from Razorpay (order, amount, status), and the database's own amount check.
 * A browser that simply claims success gets nowhere: without a valid signature
 * there is nothing to verify.
 */
export async function verifyAndConfirmPayment(payload: unknown): Promise<VerifyPaymentResult> {
  const parsed = parseVerificationPayload(payload);

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  if (!isPaymentGatewayConfigured()) {
    return { ok: false, error: GATEWAY_NOT_CONFIGURED };
  }

  if (!verifyCheckoutSignature(parsed.value)) {
    console.error("[payments] rejected a checkout response with an invalid signature");

    return { ok: false, error: UNVERIFIED };
  }

  // Ask Razorpay what actually happened. If the gateway cannot be reached the
  // signature above is still the authoritative check, so the payment is allowed
  // through and the discrepancy is logged.
  const payment = await fetchRazorpayPayment(parsed.value.paymentId);
  let amountPaise: number | null = null;

  if (payment.ok) {
    if (payment.data.order_id && payment.data.order_id !== parsed.value.orderId) {
      console.error("[payments] payment belongs to a different order");

      return { ok: false, error: UNVERIFIED };
    }

    if (payment.data.status !== "captured" && payment.data.status !== "authorized") {
      return {
        ok: false,
        error: {
          kind: "unavailable",
          message: `The payment was not completed (status: ${payment.data.status}), so the booking is still pending.`,
        },
      };
    }

    amountPaise = payment.data.amount;
  } else {
    console.warn(`[payments] could not read the payment back from Razorpay: ${payment.message}`);
  }

  if (!databaseReady()) {
    return { ok: false, error: DATABASE_NOT_CONFIGURED };
  }

  type ConfirmRow = {
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
    event_date: string;
    start_time: string | null;
    end_time: string | null;
    pass_name: string;
    pass_composition: string | null;
    currency: string;
    passes_issued: number;
    already_confirmed: boolean;
    capacity_note: string | null;
  };

  let row: ConfirmRow | undefined;

  try {
    const rows = await rpc<ConfirmRow>("confirm_booking_payment", {
      p_razorpay_order_id: parsed.value.orderId,
      p_razorpay_payment_id: parsed.value.paymentId,
      p_amount_paise: amountPaise,
    });
    row = rows[0];
  } catch (error) {
    return { ok: false, error: mapConfirmationError(error) };
  }

  if (!row) {
    return {
      ok: false,
      error: {
        kind: "server-error",
        message: "The payment was verified but the booking could not be updated.",
      },
    };
  }

  return {
    ok: true,
    payment: {
      booking: mapConfirmedBooking(row),
      alreadyConfirmed: row.already_confirmed,
      capacityNote: row.capacity_note,
    },
  };
}

function mapConfirmationError(error: unknown): BookingApiError {
  const code = error instanceof DatabaseError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[payments] confirm_booking_payment failed: ${code ?? "unknown"} ${message}`);

  switch (code) {
    case "PC001":
      return { kind: "not-found", message: "We could not find a booking for this payment." };
    case "PC002":
      return {
        kind: "invalid-input",
        message: "The amount paid does not match this booking, so it was not confirmed.",
      };
    case "PC003":
      return {
        kind: "invalid-input",
        message: "That payment has already been used for another booking.",
      };
    case "PC005":
      return { kind: "invalid-input", message: "That payment reference is not usable." };
    default:
      return { kind: "server-error", message: "The payment was verified but the booking could not be updated." };
  }
}

/** Customer-facing status lookup by the booking's random token. */
export async function getBookingStatusByToken(
  token: unknown,
): Promise<{ ok: true; booking: BookingStatusView } | { ok: false; error: BookingApiError }> {
  if (typeof token !== "string" || !UUID_PATTERN.test(token.trim())) {
    return { ok: false, error: { kind: "invalid-input", message: "That booking link is not valid." } };
  }

  if (!databaseReady()) {
    return { ok: false, error: DATABASE_NOT_CONFIGURED };
  }

  try {
    const rows = await rpc<Record<string, unknown>>("get_booking_status", {
      p_public_token: token.trim(),
    });

    const row = rows[0];

    if (!row) {
      return { ok: false, error: { kind: "not-found", message: "We could not find that booking." } };
    }

    return {
      ok: true,
      booking: {
        reference: row.booking_reference as string,
        status: row.booking_status as BookingStatusView["status"],
        paymentStatus: row.payment_status as BookingStatusView["paymentStatus"],
        quantity: row.quantity as number,
        numberOfPeople: row.number_of_people as number,
        totalAmount: row.total_amount as number,
        currency: row.currency as string,
        eventName: row.event_name as string,
        eventDate: row.event_date as string,
        startTime: (row.start_time as string | null) ?? null,
        endTime: (row.end_time as string | null) ?? null,
        venueName: row.venue_name as string,
        city: row.city as string,
        passName: row.pass_name as string,
        passComposition: (row.pass_composition as string | null) ?? null,
        passesIssued: row.passes_issued as number,
        createdAt: row.created_at as string,
      },
    };
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[payments] booking status lookup failed:", dbError.message, dbError.code);
    return {
      ok: false,
      error: { kind: "server-error", message: "We could not look up that booking right now." },
    };
  }
}

type RazorpayEventInput = {
  eventId: string;
  eventType: string;
  orderId: string | null;
  paymentId: string | null;
  amountPaise: number | null;
};

/**
 * Applies one webhook event. The database claims the delivery by its unique event
 * id, so a retried delivery can never be processed twice.
 */
export async function applyWebhookEvent(
  input: RazorpayEventInput,
): Promise<
  { ok: true; duplicate: boolean; outcome: string; reference: string | null } | { ok: false; error: BookingApiError }
> {
  if (!databaseReady()) {
    return { ok: false, error: DATABASE_NOT_CONFIGURED };
  }

  try {
    const rows = await rpc<{ duplicate?: boolean; outcome?: string; booking_reference?: string | null }>(
      "apply_razorpay_event",
      {
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_razorpay_order_id: input.orderId,
        p_razorpay_payment_id: input.paymentId,
        p_amount_paise: input.amountPaise,
      },
    );

    const row = rows[0];

    return {
      ok: true,
      duplicate: Boolean(row?.duplicate),
      outcome: row?.outcome ?? "ignored",
      reference: row?.booking_reference ?? null,
    };
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[payments] webhook handling failed:", dbError.message, dbError.code);
    return { ok: false, error: { kind: "server-error", message: "The webhook could not be processed." } };
  }
}

export function isRazorpayReady(): boolean {
  return isPaymentGatewayConfigured();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAZORPAY_ID_PATTERN = /^[A-Za-z0-9_]{6,64}$/;

type ParseResult =
  | { ok: true; value: { orderId: string; paymentId: string; signature: string } }
  | { ok: false; error: BookingApiError };

/**
 * The browser may only send these three strings. Amounts, statuses and booking
 * ids are ignored — they are read from the database or from Razorpay.
 */
export function parseVerificationPayload(payload: unknown): ParseResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, error: { kind: "invalid-input", message: "Send the payment result as JSON." } };
  }

  const input = payload as Record<string, unknown>;
  const orderId = typeof input.razorpay_order_id === "string" ? input.razorpay_order_id.trim() : "";
  const paymentId = typeof input.razorpay_payment_id === "string" ? input.razorpay_payment_id.trim() : "";
  const signature = typeof input.razorpay_signature === "string" ? input.razorpay_signature.trim() : "";

  if (!RAZORPAY_ID_PATTERN.test(orderId) || !RAZORPAY_ID_PATTERN.test(paymentId)) {
    return { ok: false, error: { kind: "invalid-input", message: "That payment reference is not usable." } };
  }

  if (!/^[0-9a-fA-F]{32,128}$/.test(signature)) {
    return { ok: false, error: UNVERIFIED };
  }

  return { ok: true, value: { orderId, paymentId, signature } };
}

function mapConfirmedBooking(row: {
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
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  pass_name: string;
  pass_composition: string | null;
  currency: string;
  passes_issued: number;
}): ConfirmedBookingView {
  return {
    id: row.booking_uuid,
    reference: row.booking_reference,
    publicToken: row.public_token,
    status: row.booking_status as ConfirmedBookingView["status"],
    paymentStatus: row.payment_status as ConfirmedBookingView["paymentStatus"],
    quantity: row.quantity,
    numberOfPeople: row.number_of_people,
    subtotal: row.subtotal,
    totalAmount: row.total_amount,
    eventId: row.event_id,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    passName: row.pass_name,
    passComposition: row.pass_composition,
    currency: row.currency,
    passesIssued: row.passes_issued,
  };
}
