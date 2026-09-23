/**
 * Staff-side view types: who is signed in, and what the gate said about a pass.
 *
 * The scanner is the only place in the app where a pass is *acted on* rather than
 * displayed, so the verdict type is explicit about every outcome the UI can show —
 * including the "no" answers, which are the ones that matter at a door.
 */

/**
 * The only role. There is one authenticated admin; no role matrix remains.
 * Kept as a named type so historical imports still compile.
 */
export type StaffRole = "super_admin";

/**
 * The signed-in administrator as admin pages see it.
 * One account, configured in the environment — no `admin_users` table.
 */
export interface StaffMember {
  id: string;
  /** Sign-in email from ADMIN_EMAIL. */
  email: string;
  fullName: string | null;
  displayName: string;
  role: StaffRole;
  lastLoginAt: string | null;
}

/**
 * Every answer the gate can give.
 *
 * `valid` means "may be admitted, press the button"; `checked_in` is what the
 * button itself returns. The rest are refusals, and each has its own wording so a
 * staff member knows whether to call a supervisor, ask for another code, or send
 * the guest to the ticket desk.
 */
export type PassEntryOutcome =
  | "valid"
  | "checked_in"
  | "already_used"
  | "payment_not_verified"
  | "refunded"
  | "expired"
  | "not_yet_valid"
  | "invalid"
  | "not_authorised";

/**
 * One pass, as the gate sees it. Never includes a mobile number: the door needs
 * a name and a pass, not a customer's contact details.
 */
export interface PassScanResult {
  outcome: PassEntryOutcome;
  /** A sentence explaining a refusal; null when there is nothing to explain. */
  reason: string | null;
  passId: string | null;
  passStatus: string | null;
  checkedIn: boolean | null;
  checkedInAt: string | null;
  passNumber: number | null;
  passTotal: number | null;
  customerName: string | null;
  passName: string | null;
  passComposition: string | null;
  bookingReference: string | null;
  bookingStatus: string | null;
  paymentStatus: string | null;
  eventName: string | null;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  /** The night the gate is working, as the server computed it. */
  gateDate: string | null;
  /** Recorded by the database on check-in (single-admin: usually null now). */
  staffName: string | null;
  /** The `check_ins` row written by a successful check-in. */
  checkInId: string | null;
}

export type ScanFailureKind =
  | "invalid-input"
  | "not-authorized"
  | "forbidden"
  | "not-configured"
  | "server-error";

export interface ScanApiError {
  kind: ScanFailureKind;
  message: string;
}

export type ScanApiResponse =
  | { ok: true; result: PassScanResult }
  | { ok: false; error: ScanApiError };
