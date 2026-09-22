import "server-only";

import { isSupabaseConfigured } from "@/config/env";
import { isQrToken } from "@/lib/pass/links";
import { fail, ok, type Result } from "@/lib/services/result";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PassEntryOutcome, PassScanResult } from "@/types/admin";
import type { PassEntryRow } from "@/types/database";

/**
 * The gate, server side.
 *
 * Two calls, both of which end up in `pass_entry()` in the database:
 *
 *   * `scanPass` — the verdict, and nothing else. Writes nothing, so an accidental
 *     scan (a passer-by's code, a QR sticker on a lamp post) can never consume a
 *     guest's pass.
 *   * `checkInPass` — the same verdict plus the admission: the compare-and-swap on
 *     the pass row and the `check_ins` audit row, in one transaction.
 *
 * This module deliberately makes **no decision** about whether a pass is good. It
 * passes the token and the identity of the staff member down and maps the row back
 * up; the answer — and the race protection — is the database's. That is what makes
 * the API route safe to expose to a browser, and why a tampered scanner page can
 * only ever ask a question, never grant entry.
 */

/** Outcomes the database can return. Anything unexpected is treated as a refusal. */
const KNOWN_OUTCOMES: readonly string[] = [
  "valid",
  "checked_in",
  "already_used",
  "payment_not_verified",
  "refunded",
  "expired",
  "not_yet_valid",
  "invalid",
  "not_authorised",
];

function mapRow(row: PassEntryRow): PassScanResult {
  const outcome = (KNOWN_OUTCOMES.includes(row.outcome) ? row.outcome : "invalid") as PassEntryOutcome;

  return {
    outcome,
    reason: row.reason,
    passId: row.pass_id,
    passStatus: row.pass_status,
    checkedIn: row.checked_in,
    checkedInAt: row.checked_in_at,
    passNumber: row.pass_number,
    passTotal: row.pass_total,
    customerName: row.customer_name,
    passName: row.pass_name,
    passComposition: row.pass_composition,
    bookingReference: row.booking_reference,
    bookingStatus: row.booking_status,
    paymentStatus: row.payment_status,
    eventName: row.event_name,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    gateDate: row.gate_date,
    staffName: row.staff_name,
    checkInId: row.check_in_id,
  };
}

/**
 * A refusal decided before the database is touched, for a token that is not the
 * shape the database mints.
 *
 * This is not the browser being trusted — it is the server applying its own
 * cheapest check first. It is safe by construction: the answer is a refusal, and a
 * refusal cannot admit anybody. Nothing that could *grant* entry is ever decided
 * outside the database.
 */
function malformedToken(reason: string): PassScanResult {
  return {
    outcome: "invalid",
    reason,
    passId: null,
    passStatus: null,
    checkedIn: null,
    checkedInAt: null,
    passNumber: null,
    passTotal: null,
    customerName: null,
    passName: null,
    passComposition: null,
    bookingReference: null,
    bookingStatus: null,
    paymentStatus: null,
    eventName: null,
    eventDate: null,
    startTime: null,
    endTime: null,
    venueName: null,
    venueAddress: null,
    city: null,
    gateDate: null,
    staffName: null,
    checkInId: null,
  };
}

const NOT_CONFIGURED = {
  kind: "not-configured" as const,
  message: "The gate is unavailable: the server is not connected to the database.",
};

interface GateCall {
  /** The token from the QR code, exactly as scanned. */
  token: unknown;
  /** The night the gate is open, already resolved from the venue's clock. */
  gateDate: string;
  /** `admin_users.user_id` of the signed-in staff member. */
  staffUserId: string;
  /** Free-text gate label for the audit row, e.g. "Gate A". */
  gate?: string | null;
}

function readOutcome(data: unknown): PassEntryRow | null {
  const rows = Array.isArray(data) ? data : data ? [data] : [];

  return (rows[0] as PassEntryRow | undefined) ?? null;
}

/** The read-only verdict for a scanned token. Writes nothing, ever. */
export async function scanPass(input: GateCall): Promise<Result<PassScanResult>> {
  if (!isQrToken(input.token)) {
    return ok(malformedToken("This code is not one of our passes. Check the guest's booking confirmation."));
  }

  if (!isSupabaseConfigured()) {
    return fail(NOT_CONFIGURED.kind, NOT_CONFIGURED.message);
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("scan_pass", {
      p_qr_token: input.token,
      p_gate_date: input.gateDate,
      p_staff_user_id: input.staffUserId,
    });

    if (error) {
      console.error("[check-in] scan_pass failed:", error.message, error.code);

      return fail("query-failed", "The gate could not check that pass. Try again in a moment.");
    }

    const row = readOutcome(data);

    if (!row) {
      console.error("[check-in] scan_pass returned no row");

      return fail("query-failed", "The gate could not check that pass. Try again in a moment.");
    }

    return ok(mapRow(row));
  } catch (error) {
    console.error("[check-in] scan_pass unavailable:", error);

    return fail(NOT_CONFIGURED.kind, NOT_CONFIGURED.message);
  }
}

/**
 * Admit the guest: the verdict again, and this time the write.
 *
 * Returns `ok` with `outcome: "checked_in"` on the one admission that won, or with
 * the refusal the database gave — including `already_used` when a second scanner
 * got there first, which is an answer, not an error.
 */
export async function checkInPass(input: GateCall): Promise<Result<PassScanResult>> {
  if (!isQrToken(input.token)) {
    return ok(malformedToken("This code is not one of our passes. Check the guest's booking confirmation."));
  }

  if (!isSupabaseConfigured()) {
    return fail(NOT_CONFIGURED.kind, NOT_CONFIGURED.message);
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("check_in_pass", {
      p_qr_token: input.token,
      p_gate_date: input.gateDate,
      p_staff_user_id: input.staffUserId,
      p_gate: input.gate ?? null,
    });

    if (error) {
      console.error("[check-in] check_in_pass failed:", error.message, error.code);

      return fail("query-failed", "The gate could not record that entry. Try again in a moment.");
    }

    const row = readOutcome(data);

    if (!row) {
      console.error("[check-in] check_in_pass returned no row");

      return fail("query-failed", "The gate could not record that entry. Try again in a moment.");
    }

    return ok(mapRow(row));
  } catch (error) {
    console.error("[check-in] check_in_pass unavailable:", error);

    return fail(NOT_CONFIGURED.kind, NOT_CONFIGURED.message);
  }
}
