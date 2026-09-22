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
 * `unpaid` is the schema's "payment not made" state; it stays `unpaid` until a
 * verified Razorpay signature moves it to `paid` (a later step). Nothing in the
 * booking flow can set `paid`, `created` or `refunded`.
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
  createdAt: string;
  /** True when a retried/duplicate attempt returned an existing booking. */
  reusedExisting: boolean;
}

export type BookingFailureKind =
  /** The input did not survive validation. */
  | "invalid-input"
  /** The night, the pass or the remaining capacity cannot serve this booking. */
  | "unavailable"
  /** The server has no database credentials. */
  | "not-configured"
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
