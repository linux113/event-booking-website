import "server-only";

import {
  OPERATIONS_PAGE_SIZE,
  PASS_EXPORT_BATCH_SIZE,
  PASS_EXPORT_MAX_ROWS,
  passOffset,
  paymentOffset,
  type PassExportRow,
  type PassQuery,
  type PaymentQuery,
} from "@/lib/admin/operations";
import { can, type StaffRole } from "@/lib/auth/permissions";
import { siteConfig } from "@/config/site";
import { fail, ok, type Result } from "@/lib/services/result";
import { getAdminClient } from "@/lib/services/admin-client";
import type { Database } from "@/types/database";

/**
 * Reads for the two operations screens — /admin/payments and /admin/passes.
 *
 * Server only, and the same three rules as the booking list in `admin.ts`:
 *
 *   1. **The database filters, sorts, pages and counts.** Nothing is fetched to be
 *      filtered in Node, so an unsupported filter cannot quietly widen a result set and
 *      a total cannot drift from the rows it describes.
 *   2. **The role decides the shape of the answer.** Contact details, amounts and
 *      gateway ids are requested with `p_include_contact`, decided from the caller's
 *      permissions — for a staff session they are never returned at all, so there is
 *      nothing to remember to hide.
 *   3. **Nothing here writes.** A payment status is moved by a verified gateway event
 *      and by nothing else — the guard trigger `PB007` refuses every other path — so
 *      these two screens are reads by construction, not by discipline.
 */

type EventRow = Database["public"]["Functions"]["admin_payment_events"]["Returns"][number];
type AttentionRow = Database["public"]["Functions"]["admin_payment_attention"]["Returns"][number];
type SummaryRow = Database["public"]["Functions"]["admin_payment_summary"]["Returns"][number];
type PassRow = Database["public"]["Functions"]["admin_pass_list"]["Returns"][number];
type PassSummaryRow = Database["public"]["Functions"]["admin_pass_summary"]["Returns"][number];

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

export type PaymentEventRow = EventRow;
export type PaymentAttentionRow = AttentionRow;
export type PaymentSummary = SummaryRow;

/** One page of the gateway's deliveries. */
export interface PaymentEventPage {
  rows: PaymentEventRow[];
  total: number;
  page: number;
  pageSize: number;
  includeContact: boolean;
}

export interface PaymentSnapshot {
  summary: PaymentSummary | null;
  attention: PaymentAttentionRow[];
  attentionTotal: number;
  events: PaymentEventPage;
  includeContact: boolean;
}

/**
 * The size of a match when the page asked for is empty.
 *
 * `total_count` arrives as a window count, which means it only arrives with a row — and a
 * page beyond the end has no rows. Rather than let the screen say "no passes issued yet"
 * about an event that holds five thousand of them, an empty page asks the first page what
 * it is past the end of. One extra query, and only when the screen would otherwise be
 * blank.
 */
async function totalWhenPageIsEmpty(
  rows: readonly { total_count?: number | null }[],
  page: number,
  firstPage: () => PromiseLike<{ data: unknown }>,
): Promise<number> {
  if (rows.length > 0 || page <= 1) {
    return rows[0]?.total_count ?? 0;
  }

  const probe = await firstPage();
  const probeRows = Array.isArray(probe.data) ? (probe.data as { total_count?: number | null }[]) : [];

  return probeRows[0]?.total_count ?? 0;
}

/**
 * Everything /admin/payments shows, in three reads that go out together.
 *
 * `admin_payment_summary` counts what the gateway sent, `admin_payment_attention` lists
 * the rows whose payment state contradicts the rest of the row, and
 * `admin_payment_events` is the delivery log itself. The attention list is asked for a
 * generous page (the reason it exists is to be looked at, and a screen that hides the
 * fourth problem behind a "next page" link is a screen where the fourth problem is
 * never seen), while the delivery log is paged like every other list here.
 */
export async function getPaymentsSnapshot(
  query: PaymentQuery,
  role: StaffRole,
): Promise<Result<PaymentSnapshot>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const includeContact = can(role, "bookings:view_contact");

  const [summary, attention, events] = await Promise.all([
    client.client.rpc("admin_payment_summary", { p_include_contact: includeContact }),
    client.client.rpc("admin_payment_attention", { p_include_contact: includeContact, p_limit: 50 }),
    client.client.rpc("admin_payment_events", {
      p_query: query.q || null,
      p_outcome: query.outcome,
      p_event_type: query.eventType,
      p_from: query.from,
      p_to: query.to,
      p_include_contact: includeContact,
      p_limit: OPERATIONS_PAGE_SIZE,
      p_offset: paymentOffset(query.page),
    }),
  ]);

  const failure = [summary, attention, events].find((response) => response.error);

  if (failure?.error) {
    console.error("[admin] payments read failed:", failure.error.message, failure.error.code);

    return fail("query-failed", "We could not load the payment records right now.");
  }

  const eventRows = Array.isArray(events.data) ? events.data : [];
  const attentionRows = Array.isArray(attention.data) ? attention.data : [];
  const eventsTotal = await totalWhenPageIsEmpty(eventRows, query.page, () =>
    client.client.rpc("admin_payment_events", {
      p_query: query.q || null,
      p_outcome: query.outcome,
      p_event_type: query.eventType,
      p_from: query.from,
      p_to: query.to,
      p_include_contact: includeContact,
      p_limit: 1,
      p_offset: 0,
    }),
  );

  return ok({
    // An empty answer means the migrations are not applied yet: the page renders its
    // empty states rather than inventing figures.
    summary: (Array.isArray(summary.data) ? summary.data : [])[0] ?? null,
    attention: attentionRows,
    // Every row carries the same window count; with no rows there is nothing to count.
    attentionTotal: attentionRows[0]?.total_count ?? 0,
    events: {
      rows: eventRows,
      total: eventsTotal,
      page: query.page,
      pageSize: OPERATIONS_PAGE_SIZE,
      includeContact,
    },
    includeContact,
  });
}

// -----------------------------------------------------------------------------
// Passes
// -----------------------------------------------------------------------------

export type PassListRow = PassRow;
export type PassSummary = PassSummaryRow;

export interface PassPage {
  rows: PassListRow[];
  total: number;
  page: number;
  pageSize: number;
  includeContact: boolean;
}

export interface PassSnapshot {
  summary: PassSummary | null;
  list: PassPage;
  includeContact: boolean;
}

/**
 * Everything /admin/passes shows: the counts above the list, and the list.
 *
 * `admin_pass_summary` is counted in the venue's timezone (`siteConfig.timezone`), so
 * "checked in today" means the day it is at the gate and not the day it is on the
 * server.
 */
export async function getPassesSnapshot(query: PassQuery, role: StaffRole): Promise<Result<PassSnapshot>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const includeContact = can(role, "bookings:view_contact");

  const [summary, list] = await Promise.all([
    client.client.rpc("admin_pass_summary", { p_tz: siteConfig.timezone, p_include_contact: includeContact }),
    client.client.rpc("admin_pass_list", {
      p_query: query.q || null,
      p_status: query.status,
      p_check_in: query.checkIn,
      p_event_date_id: query.eventDateId,
      p_from: query.from,
      p_to: query.to,
      p_include_contact: includeContact,
      p_limit: OPERATIONS_PAGE_SIZE,
      p_offset: passOffset(query.page),
    }),
  ]);

  const failure = [summary, list].find((response) => response.error);

  if (failure?.error) {
    console.error("[admin] passes read failed:", failure.error.message, failure.error.code);

    return fail("query-failed", "We could not load the pass list right now.");
  }

  const rows = Array.isArray(list.data) ? list.data : [];
  const total = await totalWhenPageIsEmpty(rows, query.page, () =>
    client.client.rpc("admin_pass_list", {
      p_query: query.q || null,
      p_status: query.status,
      p_check_in: query.checkIn,
      p_event_date_id: query.eventDateId,
      p_from: query.from,
      p_to: query.to,
      p_include_contact: includeContact,
      p_limit: 1,
      p_offset: 0,
    }),
  );

  return ok({
    summary: (Array.isArray(summary.data) ? summary.data : [])[0] ?? null,
    list: {
      rows,
      total,
      page: query.page,
      pageSize: OPERATIONS_PAGE_SIZE,
      includeContact,
    },
    includeContact,
  });
}

/**
 * Every pass matching the filters, for the door list.
 *
 * The rows are returned in the same shape the export writer expects (`PassExportRow`),
 * mapped from the database's snake_case once, here — so the writer, the table and the
 * tests all speak about a pass the same way.
 */
export async function collectPassesForExport(
  query: PassQuery,
  role: StaffRole,
  maxRows: number = PASS_EXPORT_MAX_ROWS,
): Promise<Result<{ rows: PassExportRow[]; includeContact: boolean; truncated: boolean }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const includeContact = can(role, "bookings:view_contact");
  const rows: PassExportRow[] = [];
  let offset = 0;
  let total = 0;

  for (;;) {
    const { data, error } = await client.client.rpc("admin_pass_list", {
      p_query: query.q || null,
      p_status: query.status,
      p_check_in: query.checkIn,
      p_event_date_id: query.eventDateId,
      p_from: query.from,
      p_to: query.to,
      p_include_contact: includeContact,
      p_limit: PASS_EXPORT_BATCH_SIZE,
      p_offset: offset,
    });

    if (error) {
      console.error("[admin] pass export failed:", error.message, error.code);

      return fail("query-failed", "We could not build the door list right now.");
    }

    const batch = Array.isArray(data) ? data : [];

    total = batch[0]?.total_count ?? total;

    for (const pass of batch) {
      rows.push({
        passId: pass.pass_id,
        passNumber: pass.pass_number,
        passStatus: pass.pass_status,
        checkedIn: pass.checked_in,
        checkedInAt: pass.checked_in_at,
        validDate: pass.valid_date,
        gate: pass.gate,
        admittedBy: pass.admitted_by,
        bookingId: pass.booking_id,
        bookingStatus: pass.booking_status,
        paymentStatus: pass.payment_status,
        customerName: pass.customer_name,
        customerMobile: pass.customer_mobile,
        passName: pass.pass_name,
        passesOnBooking: pass.passes_on_booking,
        totalAmount: pass.total_amount,
        currency: pass.currency,
        issuedAt: pass.issued_at,
      });
    }

    offset += batch.length;

    if (batch.length < PASS_EXPORT_BATCH_SIZE || rows.length >= maxRows) {
      break;
    }
  }

  return ok({
    rows: rows.slice(0, maxRows),
    includeContact,
    // Incomplete means the database says there are more passes than this file holds.
    truncated: rows.length < total,
  });
}
