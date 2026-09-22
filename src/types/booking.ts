/**
 * Booking flow types.
 *
 * `BookingRequestInput` is exactly what the browser is allowed to send: identifiers
 * only. There is deliberately **no price, subtotal or total field** — the server
 * reads the price from `pass_categories` and the database computes the amounts, so
 * a tampered request cannot change what a booking costs.
 */

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "refunded";

/**
 * `unpaid` is the schema's "payment not made" state. Only a server-verified
 * Razorpay payment moves a booking to `paid` (or a refund to `refunded`), and only
 * inside the `confirm_booking_payment()` / `refund_booking_payment()` functions —
 * the browser cannot set any of these values.
 */
export type PaymentStatus = "unpaid" | "created" | "paid" | "failed" | "refunded";

/** Fields that can carry a validation error back to the wizard. */
export type BookingField =
  | "eventDateId"
  | "passCategoryId"
  | "customerName"
  | "customerMobile"
  | "customerEmail"
  | "quantity"
  | "numberOfPeople";

export type BookingFieldErrors = Partial<Record<BookingField, string>>;

/** The only payload the browser may post. No amounts, ever. */
export interface BookingRequestInput {
  eventId: string;
  eventDateId: string;
  passCategoryId: string;
  customerName: string;
  /** Normalised to `+91XXXXXXXXXX` before it is sent. */
  customerMobile: string;
  customerEmail: string;
  quantity: number;
  numberOfPeople: number;
  /** Per-attempt key so a retried request cannot create a second booking. */
  idempotencyKey: string;
}

/** A booking as the server confirmed it — every amount comes from the database. */
export interface CreatedBooking {
  id: string;
  /** Customer-facing reference, e.g. `DND202600001`. */
  reference: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  quantity: number;
  numberOfPeople: number;
  /** Whole rupees, computed by the database from the pass category price. */
  subtotal: number;
  totalAmount: number;
  eventId: string;
  eventDateId: string;
  /** `YYYY-MM-DD`. */
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  passCategoryId: string;
  passName: string;
  passComposition: string | null;
  currency: string;
  /** Random token for the customer's own status lookup. Never a guessable id. */
  publicToken: string;
  /** Set once a Razorpay order is attached to this booking. */
  razorpayOrderId: string | null;
  createdAt: string;
  /** True when a retried/duplicate attempt returned an existing booking. */
  reusedExisting: boolean;
}

export type BookingFailureKind =
  /** The input did not survive validation. */
  | "invalid-input"
  /** The night, the pass or the remaining capacity cannot serve this booking. */
  | "unavailable"
  /** The booking is already paid; there is nothing left to collect. */
  | "already-paid"
  /** The referenced booking or order does not exist. */
  | "not-found"
  /** The server has no database credentials. */
  | "not-configured"
  /** Razorpay is not configured, or a live key was blocked. */
  | "gateway-unavailable"
  /** Anything unexpected. */
  | "server-error";

export interface BookingApiError {
  kind: BookingFailureKind;
  /** Safe to show: never contains SQL, a table name or a connection detail. */
  message: string;
  /** Per-field messages for the wizard to place next to the inputs. */
  fieldErrors?: BookingFieldErrors;
}

export type BookingApiResponse =
  | { ok: true; booking: CreatedBooking }
  | { ok: false; error: BookingApiError };

/** Steps of the checkout wizard. */
export type BookingStep = 1 | 2 | 3 | 4;

/** Customer-entered details before they are normalised. */
export interface BookingDetailsDraft {
  customerName: string;
  customerMobile: string;
  customerEmail: string;
  quantity: string;
  numberOfPeople: string;
}

// -----------------------------------------------------------------------------
// Payments (Razorpay, test mode)
// -----------------------------------------------------------------------------

/**
 * Everything the browser needs to open Razorpay Checkout — and nothing more.
 *
 * `amountPaise` is the amount the *database* fixed for this booking (rupees × 100),
 * echoed back so the customer sees the right figure. The Checkout window is opened
 * with the order id, and Razorpay charges what the order says, so a modified page
 * cannot change the price.
 */
export interface PaymentOrderView {
  orderId: string;
  amountPaise: number;
  currency: string;
  /** Public key id. The key secret never leaves the server. */
  keyId: string;
  booking: CreatedBooking;
  /** Prefill values the server already has for this booking (never client input). */
  prefill: { name: string; email: string; contact: string };
  description: string;
}

/** The values Razorpay Checkout hands back, which the server then verifies. */
export interface CheckoutPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** A booking as it stands after payment, with no customer details attached. */
export interface ConfirmedBookingView {
  id: string;
  reference: string;
  publicToken: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  quantity: number;
  numberOfPeople: number;
  subtotal: number;
  totalAmount: number;
  eventId: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  passName: string;
  passComposition: string | null;
  currency: string;
  /** Digital passes issued so far for this booking. */
  passesIssued: number;
}

/** Result of a server-verified payment. */
export interface PaymentConfirmation {
  booking: ConfirmedBookingView;
  /** True when this payment had already been confirmed (duplicate callback). */
  alreadyConfirmed: boolean;
  /** Set when the night filled up before the payment landed. */
  capacityNote: string | null;
}

/** Customer-facing view of one booking, looked up by its random token. */
export interface BookingStatusView {
  reference: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  quantity: number;
  numberOfPeople: number;
  totalAmount: number;
  currency: string;
  eventName: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  venueName: string;
  city: string;
  passName: string;
  passComposition: string | null;
  passesIssued: number;
  createdAt: string;
}

export type PaymentOrderApiResponse =
  | { ok: true; order: PaymentOrderView }
  | { ok: false; error: BookingApiError };

export type PaymentVerifyApiResponse =
  | { ok: true; payment: PaymentConfirmation }
  | { ok: false; error: BookingApiError };

export type PaymentStatusApiResponse =
  | { ok: true; booking: BookingStatusView }
  | { ok: false; error: BookingApiError };

/**
 * Where the checkout stands on the review step.
 *
 * `creating` — the server is creating the booking and the Razorpay order
 * `paying`   — Checkout is open, waiting for the customer
 * `verifying` — Checkout returned; the server is verifying the signature
 */
export type PaymentPhase = "editing" | "creating" | "paying" | "verifying";
