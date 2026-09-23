import "server-only";

import { isSupabaseConfigured } from "@/config/env";
import { buildPassPath, buildVerifyUrl, isQrToken } from "@/lib/pass/links";
import { passDisplayLabel, toPassDisplayStatus, todayIsoDate } from "@/lib/pass/status";
import { fail, ok, type Result, type ServiceError } from "@/lib/services/result";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { DigitalPassSummary, DigitalPassTicket, PassStatus } from "@/types/pass";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Digital passes — server side only.
 *
 * Two reads, both reached through a secret the customer already has:
 *
 *   * `getBookingPasses(publicToken)` — the passes of one booking, for the success
 *     page. The token is the booking's random uuid.
 *   * `getDigitalPassByToken(qrToken)` — one pass resolved from the token inside its
 *     QR code, for the ticket page and the gate verification page.
 *
 * Neither path can create or change a pass: passes are issued by
 * `confirm_booking_payment()` when a payment is verified, one per purchased pass,
 * and a replay returns the existing rows. Opening (or refreshing) a page can
 * therefore never mint a second pass.
 *
 * The lookups return no mobile number and no email address — a pass has to be safe
 * to show at a gate, and the customer's contact details are not the gate's business.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminClientResult =
  | { ok: true; client: SupabaseClient<Database> }
  | { ok: false; error: ServiceError };

const NOT_CONFIGURED: ServiceError = {
  kind: "not-configured",
  message: "Passes are temporarily unavailable: the server is not connected to the database.",
};

function getAdminClient(): AdminClientResult {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: NOT_CONFIGURED };
  }

  try {
    return { ok: true, client: createSupabaseAdminClient() };
  } catch (error) {
    console.error("[passes] admin client unavailable:", error);

    return { ok: false, error: NOT_CONFIGURED };
  }
}

type PassRow = Database["public"]["Functions"]["get_booking_passes"]["Returns"][number];

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

async function readBookingPasses(
  client: SupabaseClient<Database>,
  publicToken: string,
): Promise<Result<DigitalPassSummary[]>> {
  const { data, error } = await client.rpc("get_booking_passes", { p_public_token: publicToken });

  if (error) {
    console.error("[passes] get_booking_passes failed:", error.message, error.code);

    return fail("query-failed", "We could not load the passes for this booking right now.");
  }

  return ok((data ?? []).map(mapPass));
}

/**
 * The passes behind a booking's public token — what the success page lists.
 * An unpaid booking simply has no passes yet; that is an empty list, not an error.
 */
export async function getBookingPasses(publicToken: unknown): Promise<Result<DigitalPassSummary[]>> {
  if (typeof publicToken !== "string" || !UUID_PATTERN.test(publicToken.trim())) {
    return fail("not-found", "That booking link is not valid.");
  }

  const admin = getAdminClient();

  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  return readBookingPasses(admin.client, publicToken.trim());
}

type TicketRow = Database["public"]["Functions"]["get_pass_by_token"]["Returns"][number];

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

/**
 * One pass, resolved from the 64-character token in its QR code.
 *
 * Returns `ok(null)` when the token is well-formed but unknown, so a stale or
 * mistyped link renders a friendly "we could not find that pass" instead of a
 * database error.
 */
export async function getDigitalPassByToken(qrToken: unknown): Promise<Result<DigitalPassTicket | null>> {
  if (!isQrToken(qrToken)) {
    return ok(null);
  }

  const admin = getAdminClient();

  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const { data, error } = await admin.client.rpc("get_pass_by_token", { p_qr_token: qrToken });

  if (error) {
    console.error("[passes] get_pass_by_token failed:", error.message, error.code);

    return fail("query-failed", "We could not load that pass right now.");
  }

  const row = Array.isArray(data) ? data[0] : data;

  return ok(row ? mapTicket(row) : null);
}
