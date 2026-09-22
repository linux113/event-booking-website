import type { PassEntryOutcome, PassScanResult } from "@/types/admin";

/**
 * How the gate should read a verdict.
 *
 * One pure function, shared by the scanner UI and the tests, so the words on the
 * screen for each outcome are decided in exactly one place. The four headings are
 * the four things a staff member needs to be able to tell apart instantly in a
 * queue at night:
 *
 *   ✓ VALID PASS            let them in
 *   ⚠ PASS ALREADY USED     this code has been through the gate before
 *   ✕ PAYMENT NOT VERIFIED  the booking is not (or no longer) paid
 *   ✕ INVALID PASS          anything else, with the reason underneath
 *
 * The symbol is returned separately from the headline so the mark can be drawn as
 * an icon (`aria-hidden`) while the words remain the actual text — a screen reader
 * announces "VALID PASS", not "check mark VALID PASS".
 */

export type VerdictTone = "go" | "warn" | "stop" | "info";

export type VerdictSymbol = "✓" | "⚠" | "✕";

export interface VerdictPresentation {
  symbol: VerdictSymbol;
  headline: string;
  /** Whether the CHECK IN button may be pressed for this verdict. */
  canCheckIn: boolean;
  tone: VerdictTone;
  /** A quieter second line: the reason, or extra context for a good verdict. */
  detail: string | null;
  /** Shown at the very bottom of the card: what the staff member should do. */
  instruction: string;
}

/** Refusals that share the INVALID PASS heading, with their own explanation. */
const INVALID_REASONS: Partial<Record<PassEntryOutcome, string>> = {
  refunded: "The booking behind this pass was cancelled or refunded.",
  expired: "This pass was for an earlier night.",
  not_yet_valid: "This pass is for a later night — it cannot be used yet.",
  invalid: "This code does not match any pass for this event.",
};

export function presentVerdict(result: PassScanResult): VerdictPresentation {
  switch (result.outcome) {
    case "valid":
      return {
        symbol: "✓",
        headline: "VALID PASS",
        canCheckIn: true,
        tone: "go",
        detail: result.customerName ? `Admit ${result.customerName}.` : "Admit this guest.",
        instruction: "Check the name and the night against the guest, then press CHECK IN.",
      };

    case "checked_in":
      return {
        symbol: "✓",
        headline: "CHECKED IN",
        canCheckIn: false,
        tone: "go",
        detail: result.checkedInAt ? `Entry recorded at ${result.checkedInAt}.` : "Entry recorded.",
        instruction: "This guest is admitted. Scan the next pass.",
      };

    case "already_used":
      return {
        symbol: "⚠",
        headline: "PASS ALREADY USED",
        canCheckIn: false,
        tone: "warn",
        detail: result.checkedInAt
          ? `This pass was scanned at ${result.checkedInAt}. One code admits one guest, once.`
          : "This pass has already been scanned. One code admits one guest, once.",
        instruction: "Do not admit it again unless a supervisor approves the entry.",
      };

    case "payment_not_verified":
      return {
        symbol: "✕",
        headline: "PAYMENT NOT VERIFIED",
        canCheckIn: false,
        tone: "stop",
        detail:
          "No verified payment is recorded for this booking. A booking only counts as paid once the payment has been confirmed on the server.",
        instruction: "Send the guest to the ticket desk — do not admit them.",
      };

    case "not_authorised":
      return {
        symbol: "✕",
        headline: "NOT AUTHORISED",
        canCheckIn: false,
        tone: "stop",
        detail:
          result.reason ?? "This account is not allowed to check passes in — it may have been deactivated.",
        instruction: "Sign in again, or ask a supervisor to scan this pass.",
      };

    default:
      return {
        symbol: "✕",
        headline: "INVALID PASS",
        canCheckIn: false,
        tone: "stop",
        detail: result.reason ?? INVALID_REASONS[result.outcome] ?? "This code is not a valid pass.",
        instruction: "Do not admit this guest. Ask for their booking confirmation and send them to the ticket desk.",
      };
  }
}

/** Short label for a stored pass status, used in the details list. */
export function passStatusLabel(status: string | null): string {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "used":
      return "USED";
    case "cancelled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    default:
      return status ? status.toUpperCase() : "UNKNOWN";
  }
}
