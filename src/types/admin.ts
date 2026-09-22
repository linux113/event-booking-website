/**
 * Staff-side view types: who is signed in, and what the gate said about a pass.
 *
 * The scanner is the only place in the app where a pass is *acted on* rather than
 * displayed, so the verdict type is explicit about every outcome the UI can show —
 * including the "no" answers, which are the ones that matter at a door.
 */

/** Roles from `admin_users.role`; every one of them may work the gate. */
export type StaffRole = "owner" | "admin" | "manager" | "scanner";

export interface StaffMember {
  /** `admin_users.id` — recorded on every check-in this person makes. */
  id: string;
  /** `auth.users.id` — the Supabase Auth identity behind the row. */
  userId: string;
  email: string;
  fullName: string | null;
  /** What to call them in the UI: their name, or their email if it is not set. */
  displayName: string;
  role: StaffRole;
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
 * One pass, as the gate sees it. Never includes a mobile number or an email
 * address: the door needs a name and a pass, not a customer's contact details.
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
  /** The staff member the database recognised (proof the check was enforced there). */
  staffName: string | null;
  /** The `check_ins` row written by a successful check-in. */
  checkInId: string | null;
}

export type ScanFailureKind = "invalid-input" | "not-authorized" | "not-configured" | "server-error";

export interface ScanApiError {
  kind: ScanFailureKind;
  message: string;
}

export type ScanApiResponse =
  | { ok: true; result: PassScanResult }
  | { ok: false; error: ScanApiError };
