import "server-only";

import {
  OPERATIONS_PAGE_SIZE,
  PASS_EXPORT_BATCH_SIZE,
  PASS_EXPORT_MAX_ROWS,
  passOffset,
  paymentOffset,
  type PaiseAmount,
  type PassExportRow,
  type PassQuery,
  type PaymentQuery,
} from "@/lib/admin/operations";
import { siteConfig } from "@/config/site";
import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc } from "@/lib/db/client";
import { fail, ok, type Result } from "@/lib/services/result";

/**
 * Reads for the two operations screens — /admin/payments and /admin/passes.
 *
 * Single admin: contact details and amounts are always included. Filtering,
 * sorting, paging and counting still happen in Postgres so totals cannot drift
 * from the rows they describe.
 */

function ensureDb(): Result<never> | null {
  if (!isDatabaseConfigured()) {
    return fail("not-configured", "The admin area needs the database: add DATABASE_URL and try again.");
  }
  return null;
}

function dbFailure(context: string, error: unknown): Result<never> {
  if (error instanceof DatabaseError) {
    console.error(`[admin] ${context} failed:`, error.message, error.code ?? "");
  } else {
    console.error(`[admin] ${context} failed:`, error);
  }
  return fail("query-failed", "We could not load that right now.");
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

export interface PaymentEventRow {
  event_uuid?: string;
  event_id?: string;
  event_type: string;
  outcome: string;
  amount_paise: PaiseAmount;
  currency: string | null;
  received_at: string;
  processed_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  booking_uuid?: string | null;
  booking_id: string | null;
  booking_status: string | null;
  payment_status: string | null;
  customer_name: string | null;
  total_count?: number | null;
}

export interface PaymentAttentionRow {
  booking_uuid: string;
  booking_id: string;
  customer_name: string;
  customer_mobile: string | null;
  event_date: string;
  created_at: string;
  payment_status: string;
  booking_status: string;
  total_amount: number;
  currency: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  passes_issued: number;
  passes_active: number;
  event_count: number;
  reason_code: string | null;
  reason: string | null;
  action: string | null;
  total_count?: number | null;
}

export interface PaymentSummary {
  events_total: number;
  events_confirmed: number;
  events_failed: number;
  events_refunded: number;
  events_ignored: number;
  events_duplicate: number;
  orders_awaiting: number;
  captured_paise: PaiseAmount;
  refunded_paise: PaiseAmount;
  last_received_at: string | null;
}

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

async function totalWhenPageIsEmpty<T extends { total_count?: number | null }>(
  rows: readonly T[],
  page: number,
  firstPage: () => Promise<T[]>,
): Promise<number> {
  if (rows.length > 0 || page <= 1) {
    return rows[0]?.total_count ?? 0;
  }

  const probeRows = await firstPage();
  return probeRows[0]?.total_count ?? 0;
}

/** Everything /admin/payments shows, in three reads that go out together. */
export async function getPaymentsSnapshot(query: PaymentQuery): Promise<Result<PaymentSnapshot>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<PaymentSnapshot>;

  try {
    const [summary, attention, events] = await Promise.all([
      rpc<PaymentSummary>("admin_payment_summary", { p_include_contact: true }),
      rpc<PaymentAttentionRow>("admin_payment_attention", { p_include_contact: true, p_limit: 50 }),
      rpc<PaymentEventRow>("admin_payment_events", {
        p_query: query.q || null,
        p_outcome: query.outcome,
        p_event_type: query.eventType,
        p_from: query.from,
        p_to: query.to,
        p_include_contact: true,
        p_limit: OPERATIONS_PAGE_SIZE,
        p_offset: paymentOffset(query.page),
      }),
    ]);

    const eventRows = events ?? [];
    const attentionRows = attention ?? [];

    const eventsTotal = await totalWhenPageIsEmpty(eventRows, query.page, async () => {
      return rpc<PaymentEventRow>("admin_payment_events", {
        p_query: query.q || null,
        p_outcome: query.outcome,
        p_event_type: query.eventType,
        p_from: query.from,
        p_to: query.to,
        p_include_contact: true,
        p_limit: 1,
        p_offset: 0,
      });
    });

    return ok({
      summary: (summary?.[0] as PaymentSummary | undefined) ?? null,
      attention: attentionRows,
      attentionTotal: attentionRows[0]?.total_count ?? 0,
      events: {
        rows: eventRows,
        total: eventsTotal,
        page: query.page,
        pageSize: OPERATIONS_PAGE_SIZE,
        includeContact: true,
      },
      includeContact: true,
    });
  } catch (error) {
    return dbFailure("payments read", error) as Result<PaymentSnapshot>;
  }
}

// -----------------------------------------------------------------------------
// Passes
// -----------------------------------------------------------------------------

export interface PassListRow {
  pass_uuid?: string;
  pass_id: string;
  pass_number: number;
  pass_status: string;
  checked_in: boolean;
  checked_in_at: string | null;
  valid_date: string;
  gate: string | null;
  admitted_by: string | null;
  booking_id: string;
  booking_status: string;
  payment_status: string;
  customer_name: string;
  customer_mobile: string;
  pass_name: string;
  passes_on_booking: number;
  number_of_people?: number;
  total_amount: number;
  currency: string;
  issued_at: string;
  event_name: string | null;
  start_time: string | null;
  end_time: string | null;
  total_count?: number | null;
}

export interface PassSummary {
  passes_issued: number;
  passes_active: number;
  passes_used: number;
  passes_cancelled: number;
  passes_expired: number;
  passes_revenue: number | null;
  bookings_with_passes: number;
  checked_in_total: number;
  checked_in_today: number;
  gates_used: number;
  last_check_in_at: string | null;
}

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

function passListArgs(query: PassQuery, limit: number, offset: number) {
  return {
    p_query: query.q || null,
    p_status: query.status,
    p_check_in: query.checkIn,
    p_event_date_id: query.eventDateId,
    p_from: query.from,
    p_to: query.to,
    p_include_contact: true,
    p_limit: limit,
    p_offset: offset,
  };
}

/** Everything /admin/passes shows: the counts above the list, and the list. */
export async function getPassesSnapshot(query: PassQuery): Promise<Result<PassSnapshot>> {
  const notReady = ensureDb();
  if (notReady) return notReady as Result<PassSnapshot>;

  try {
    const [summary, list] = await Promise.all([
      rpc<PassSummary>("admin_pass_summary", { p_tz: siteConfig.timezone, p_include_contact: true }),
      rpc<PassListRow>("admin_pass_list", passListArgs(query, OPERATIONS_PAGE_SIZE, passOffset(query.page))),
    ]);

    const rows = list ?? [];

    const total = await totalWhenPageIsEmpty(rows, query.page, async () => {
      return rpc<PassListRow>("admin_pass_list", passListArgs(query, 1, 0));
    });

    return ok({
      summary: (summary?.[0] as unknown as PassSummary | undefined) ?? null,
      list: {
        rows,
        total,
        page: query.page,
        pageSize: OPERATIONS_PAGE_SIZE,
        includeContact: true,
      },
      includeContact: true,
    });
  } catch (error) {
    return dbFailure("passes read", error) as Result<PassSnapshot>;
  }
}

/** Every pass matching the filters, for the door list (capped). */
export async function collectPassesForExport(
  query: PassQuery,
  maxRows: number = PASS_EXPORT_MAX_ROWS,
): Promise<Result<{ rows: PassExportRow[]; includeContact: boolean; truncated: boolean }>> {
  const notReady = ensureDb();
  if (notReady) {
    return notReady as Result<{ rows: PassExportRow[]; includeContact: boolean; truncated: boolean }>;
  }

  const rows: PassExportRow[] = [];
  let offset = 0;
  let total = 0;

  try {
    for (;;) {
      const batch = (await rpc<PassListRow>("admin_pass_list", passListArgs(query, PASS_EXPORT_BATCH_SIZE, offset))) ?? [];

      total = batch[0]?.total_count ?? total;

      for (const pass of batch) {
        rows.push({
          passId: pass.pass_id as string,
          passNumber: pass.pass_number as number,
          passStatus: pass.pass_status as string,
          checkedIn: pass.checked_in as boolean,
          checkedInAt: pass.checked_in_at as string | null,
          validDate: pass.valid_date as string,
          gate: (pass.gate as string | null) ?? null,
          admittedBy: (pass.admitted_by as string | null) ?? null,
          bookingId: pass.booking_id as string,
          bookingStatus: pass.booking_status as string,
          paymentStatus: pass.payment_status as string,
          customerName: pass.customer_name as string,
          customerMobile: pass.customer_mobile as string,
          passName: pass.pass_name as string,
          passesOnBooking: pass.passes_on_booking as number,
          totalAmount: pass.total_amount as number,
          currency: pass.currency as string,
          issuedAt: pass.issued_at as string,
        });
      }

      offset += batch.length;

      if (batch.length < PASS_EXPORT_BATCH_SIZE || rows.length >= maxRows) {
        break;
      }
    }
  } catch (error) {
    return dbFailure("pass export", error) as Result<{
      rows: PassExportRow[];
      includeContact: boolean;
      truncated: boolean;
    }>;
  }

  return ok({
    rows: rows.slice(0, maxRows),
    includeContact: true,
    truncated: rows.length < total,
  });
}
