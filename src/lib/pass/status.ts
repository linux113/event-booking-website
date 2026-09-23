import type { PassDisplayStatus, PassStatus } from "@/types/pass";

/**
 * How a stored pass becomes something a human can act on.
 *
 * Pure and dependency-free so the same rules are used by the ticket, the gate
 * verification page and the tests. Two of the four states are derived rather than
 * stored:
 *
 *   * a pass with `checked_in = true` (or `status = 'used'`) is CHECKED IN;
 *   * an unused pass whose night is in the past is EXPIRED — no scheduled job has
 *     to sweep rows for the UI to be honest about it.
 *
 * `cancelled` always wins: a refunded booking must never show as scannable even
 * if the pass was never used.
 */

const LABELS: Record<PassDisplayStatus, string> = {
  valid: "VALID",
  "checked-in": "CHECKED IN",
  cancelled: "CANCELLED",
  expired: "EXPIRED",
};

export function passDisplayLabel(displayStatus: PassDisplayStatus): string {
  return LABELS[displayStatus];
}

/** True when the pass can still be scanned at the gate. */
export function isScannable(displayStatus: PassDisplayStatus): boolean {
  return displayStatus === "valid";
}

export function toPassDisplayStatus(
  pass: { status: PassStatus; checkedIn: boolean; validDate: string },
  todayIso: string,
): PassDisplayStatus {
  if (pass.status === "cancelled") {
    return "cancelled";
  }

  if (pass.status === "expired") {
    return "expired";
  }

  if (pass.checkedIn || pass.status === "used") {
    return "checked-in";
  }

  // ISO dates compare correctly as strings, and the whole app treats a night as a
  // UTC calendar date (see src/lib/format.ts).
  if (pass.validDate < todayIso) {
    return "expired";
  }

  return "valid";
}

/** Today as `YYYY-MM-DD` in UTC — the same anchor every date in the app uses. */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
