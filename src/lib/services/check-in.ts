import "server-only";

import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc } from "@/lib/db/client";
import { isQrToken } from "@/lib/pass/links";
import { fail, ok, type Result } from "@/lib/services/result";
import type { PassEntryOutcome, PassScanResult } from "@/types/admin";
import type { PassEntryRow } from "@/types/database";

/**
 * The gate, server side.
 *
 *   * `scanPass` — the verdict, and nothing else. Writes nothing.
 *   * `checkInPass` — the same verdict plus the admission: compare-and-swap on
 *     the pass row and the `check_ins` audit row, in one transaction.
 *
 * This module makes **no decision** about whether a pass is good. It passes the
 * token down and maps the row back up; the answer — and the race protection —
 * is the database's.
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

/** A refusal decided before the database is touched, for a malformed token. */
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
  token: unknown;
  /** The night the gate is open, resolved from the venue's clock. */
  gateDate: string;
  /** Kept for call-site compatibility; not used (single-admin, no staff table). */
  staffUserId?: string | null;
  gate?: string | null;
}

function readOutcome(data: unknown): PassEntryRow | null {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return (rows[0] as PassEntryRow | undefined) ?? null;
}

function serviceFailure(context: string, error: unknown): Result<PassScanResult> {
  if (error instanceof DatabaseError) {
    console.error(`[check-in] ${context} failed:`, error.message, error.code ?? "");
  } else {
    console.error(`[check-in] ${context} unavailable:`, error);
  }
  return fail<PassScanResult>(
    "query-failed",
    "The gate could not check that pass. Try again in a moment.",
  );
}

/** The read-only verdict for a scanned token. Writes nothing, ever. */
export async function scanPass(input: GateCall): Promise<Result<PassScanResult>> {
  if (!isQrToken(input.token)) {
    return ok(malformedToken("This code is not one of our passes. Check the guest's booking confirmation."));
  }

  if (!isDatabaseConfigured()) {
    return fail(NOT_CONFIGURED.kind, NOT_CONFIGURED.message);
  }

  try {
    // Live signature: scan_pass(p_qr_token text, p_gate_date date)
    const rows = await rpc<PassEntryRow>("scan_pass", {
      p_qr_token: input.token,
      p_gate_date: input.gateDate,
    });

    const row = readOutcome(rows);

    if (!row) {
      console.error("[check-in] scan_pass returned no row");
      return fail("query-failed", "The gate could not check that pass. Try again in a moment.");
    }

    return ok(mapRow(row));
  } catch (error) {
    return serviceFailure("scan_pass", error);
  }
}

/**
 * Admit the guest: the verdict again, and this time the write.
 *
 * Live signature: check_in_pass(p_qr_token, p_gate_date, p_gate).
 */
export async function checkInPass(input: GateCall): Promise<Result<PassScanResult>> {
  if (!isQrToken(input.token)) {
    return ok(malformedToken("This code is not one of our passes. Check the guest's booking confirmation."));
  }

  if (!isDatabaseConfigured()) {
    return fail(NOT_CONFIGURED.kind, NOT_CONFIGURED.message);
  }

  try {
    const rows = await rpc<PassEntryRow>("check_in_pass", {
      p_qr_token: input.token,
      p_gate_date: input.gateDate,
      p_gate: input.gate ?? null,
    });

    const row = readOutcome(rows);

    if (!row) {
      console.error("[check-in] check_in_pass returned no row");
      return fail("query-failed", "The gate could not record that entry. Try again in a moment.");
    }

    return ok(mapRow(row));
  } catch (error) {
    return serviceFailure("check_in_pass", error);
  }
}
