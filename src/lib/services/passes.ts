import "server-only";

import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc, sql } from "@/lib/db/client";
import { buildPassPath, buildVerifyUrl, isQrToken } from "@/lib/pass/links";
import { passDisplayLabel, toPassDisplayStatus, todayIsoDate } from "@/lib/pass/status";
import { fail, ok, type Result, type ServiceError } from "@/lib/services/result";
import type { DigitalPassSummary, DigitalPassTicket, PassStatus } from "@/types/pass";

/**
 * Digital passes — server side only.
 *
 *   * `getBookingPasses(publicToken)` — passes of one booking (success page).
 *   * `getDigitalPassByToken(qrToken)` — one pass from its QR token.
 *
 * Neither path can create or change a pass: passes are issued by
 * `confirm_booking_payment()` when a payment is verified.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_CONFIGURED: ServiceError = {
  kind: "not-configured",
  message: "Passes are temporarily unavailable: the server is not connected to the database.",
};

function ensureConfigured(): ServiceError | null {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  return null;
}

type PassRow = {
  pass_id: string;
  pass_number: number;
  pass_total: number;
  pass_status: string;
  checked_in: boolean;
  checked_in_at: string | null;
  valid_date: string;
  issued_at: string;
  qr_token: string;
};

function mapPass(row: PassRow): DigitalPassSummary {
  const status = row.pass_status as PassStatus;
  const displayStatus = toPassDisplayStatus(
    { status, checkedIn: row.checked_in, validDate: row.valid_date },
    todayIsoDate(),
  );

  return {
    passId: row.pass_id,
    passNumber: row.pass_number,
    passTotal: row.pass_total,
    status,
    displayStatus,
    displayLabel: passDisplayLabel(displayStatus),
    checkedIn: row.checked_in,
    checkedInAt: row.checked_in_at,
    validDate: row.valid_date,
    issuedAt: row.issued_at,
    qrToken: row.qr_token,
    verifyUrl: buildVerifyUrl(row.qr_token),
    passPath: buildPassPath(row.pass_id, row.qr_token),
  };
}

function queryError(context: string, error: unknown): Result<never> {
  if (error instanceof DatabaseError) {
    console.error(`[passes] ${context} failed:`, error.message, error.code ?? "");
  } else {
    console.error(`[passes] ${context} failed:`, error);
  }
  return fail("query-failed", "We could not load that pass right now.");
}

/**
 * The passes behind a booking's public token — what the success page lists.
 * An unpaid booking has no passes yet; that is an empty list, not an error.
 */
export async function getBookingPasses(publicToken: unknown): Promise<Result<DigitalPassSummary[]>> {
  if (typeof publicToken !== "string" || !UUID_PATTERN.test(publicToken.trim())) {
    return fail("not-found", "That booking link is not valid.");
  }

  const notConfigured = ensureConfigured();
  if (notConfigured) return { ok: false, error: notConfigured };

  try {
    const rows = await rpc<PassRow>("get_booking_passes", { p_public_token: publicToken.trim() });
    return ok((rows ?? []).map(mapPass));
  } catch (error) {
    return queryError("get_booking_passes", error);
  }
}

type TicketRow = PassRow & {
  booking_reference: string;
  booking_status: string;
  payment_status: string;
  customer_name: string;
  quantity: number;
  total_amount: number;
  currency: string;
  event_name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  venue_name: string;
  venue_address: string | null;
  city: string;
  pass_name: string;
  pass_composition: string | null;
};

function mapTicket(row: TicketRow): DigitalPassTicket {
  const status = row.pass_status as PassStatus;
  const displayStatus = toPassDisplayStatus(
    { status, checkedIn: row.checked_in, validDate: row.valid_date },
    todayIsoDate(),
  );

  return {
    pass: {
      passId: row.pass_id,
      passNumber: row.pass_number,
      passTotal: row.pass_total,
      status,
      displayStatus,
      displayLabel: passDisplayLabel(displayStatus),
      checkedIn: row.checked_in,
      checkedInAt: row.checked_in_at,
      validDate: row.valid_date,
      issuedAt: row.issued_at,
      qrToken: row.qr_token,
      verifyUrl: buildVerifyUrl(row.qr_token),
      passPath: buildPassPath(row.pass_id, row.qr_token),
    },
    bookingReference: row.booking_reference,
    bookingStatus: row.booking_status as DigitalPassTicket["bookingStatus"],
    paymentStatus: row.payment_status as DigitalPassTicket["paymentStatus"],
    customerName: row.customer_name,
    quantity: row.quantity,
    totalAmount: row.total_amount,
    currency: row.currency,
    eventName: row.event_name,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    passName: row.pass_name,
    passComposition: row.pass_composition,
  };
}

/** One pass, resolved from the 64-character token in its QR code. */
export async function getDigitalPassByToken(qrToken: unknown): Promise<Result<DigitalPassTicket | null>> {
  if (!isQrToken(qrToken)) {
    return ok(null);
  }

  const notConfigured = ensureConfigured();
  if (notConfigured) return { ok: false, error: notConfigured };

  try {
    const rows = await rpc<TicketRow>("get_pass_by_token", { p_qr_token: qrToken });
    const row = rows[0];
    return ok(row ? mapTicket(row) : null);
  } catch (error) {
    return queryError("get_pass_by_token", error);
  }
}
