import type { BookingStatus, PaymentStatus } from "@/types/booking";

/**
 * Digital pass view models.
 *
 * A pass is the scannable half of a booking: one row per purchased pass, each with
 * its own 64-character QR token. The token — never the booking reference, the
 * mobile number or anything else personal — is what the QR code contains, so a
 * photo of a pass reveals nothing that is not already printed on the pass.
 */

/** The stored states allowed by `digital_passes.status`. */
export type PassStatus = "active" | "used" | "cancelled" | "expired";

/**
 * What the customer and the gate see. `checked-in` and `expired` are derived
 * (a pass is "used" once scanned, and a pass for a night that has passed is no
 * longer scannable), so the UI never has to reason about the raw columns.
 */
export type PassDisplayStatus = "valid" | "checked-in" | "cancelled" | "expired";

export interface DigitalPassSummary {
  /** `PS-000123` — the number printed on the pass and quoted at the gate. */
  passId: string;
  /** Which pass of the booking this is, 1-based. */
  passNumber: number;
  /** How many passes the booking has, so the ticket can say "1 of 2". */
  passTotal: number;
  status: PassStatus;
  displayStatus: PassDisplayStatus;
  /** `VALID` / `CHECKED IN` / `CANCELLED` / `EXPIRED`. */
  displayLabel: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  /** The night the pass admits, `YYYY-MM-DD`. */
  validDate: string;
  issuedAt: string;
  /**
   * The 64-character secret inside the QR code. Server-side only — it is the
   * credential in the `/pass/...` and `/verify/...` URLs, never rendered as text.
   */
  qrToken: string;
  /** Absolute URL the QR encodes: `<site>/verify/<qrToken>`. */
  verifyUrl: string;
  /** Root-relative pass page including its token: `/pass/PS-000123?t=<qrToken>`. */
  passPath: string;
}

/** Everything the ticket page and the gate verification page show. */
export interface DigitalPassTicket {
  pass: DigitalPassSummary;
  bookingReference: string;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  customerName: string;
  quantity: number;
  totalAmount: number;
  currency: string;
  eventName: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  venueName: string;
  venueAddress: string | null;
  city: string;
  passName: string;
  passComposition: string | null;
}
