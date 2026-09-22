import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { StatusPill, statusTone } from "@/components/admin/status-pill";
import type { PaymentAttentionRow } from "@/lib/services/admin-operations";
import { formatEventDate, formatInr, formatTimestamp } from "@/lib/format";

/**
 * The rows that contradict themselves.
 *
 * Every entry here is a state the database's own rules call a contradiction — paid with
 * no pass issued, refunded with a pass still active, a delivery we could not act on — and
 * each one carries *why* it is listed and *what to do about it*, because a screen that
 * lists "things that look odd" without either is a screen nobody trusts. The reason and
 * the action are decided in SQL (`admin_payment_attention`), next to the rule they
 * describe, rather than paraphrased here.
 *
 * Nothing on this list can be fixed from this screen, on purpose: the fix for a payment
 * the gateway captured but the site missed is to re-deliver the gateway's event, and the
 * fix for a pass that should not exist is on the pass list. A button here would be a
 * button that writes a payment status, which is the one thing the database refuses.
 */
export function PaymentAttentionList({
  rows,
  includeContact,
}: {
  rows: readonly PaymentAttentionRow[];
  includeContact: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="border-peacock/30 bg-peacock/5 text-peacock-soft rounded-2xl border px-4 py-4 text-sm/6">
        Nothing needs attention: every paid booking has its pass, every refunded booking has no active pass, and every
        delivery the gateway sent was acted on.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li
          key={`${row.reason_code}-${row.booking_uuid}`}
          className="border-marigold/35 bg-marigold/[0.06] flex flex-col gap-3 rounded-2xl border p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="font-semibold tracking-tight">{row.reason}</p>
              <p className="text-muted text-sm/6">{row.action}</p>
            </div>
            <StatusPill label={row.payment_status} tone={statusTone(row.payment_status)} />
          </div>

          <dl className="text-muted grid gap-x-6 gap-y-1.5 text-xs/5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="Booking"
              value={
                <Link
                  href={`/admin/bookings/${encodeURIComponent(row.booking_id)}` as Route}
                  className="text-foreground focus-visible:ring-marigold/40 font-mono font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  {row.booking_id}
                </Link>
              }
            />
            <Fact label="Guest" value={row.customer_name} />
            {includeContact ? <Fact label="Mobile" value={row.customer_mobile ?? "—"} /> : null}
            <Fact label="Night" value={formatEventDate(row.event_date)} />
            <Fact label="Booking status" value={row.booking_status} />
            <Fact
              label="Passes"
              value={`${row.passes_active} active of ${row.passes_issued} issued`}
            />
            {row.event_count > 0 ? (
              <Fact
                label="Events not acted on"
                value={`${row.event_count} — see the log below`}
              />
            ) : null}
            {includeContact ? (
              <>
                <Fact
                  label="Amount"
                  value={row.total_amount === null ? "—" : formatInr(row.total_amount, row.currency)}
                />
                <Fact label="Razorpay order" value={row.razorpay_order_id ?? "—"} />
                <Fact label="Razorpay payment" value={row.razorpay_payment_id ?? "—"} />
              </>
            ) : null}
            <Fact label="Booked" value={formatTimestamp(row.created_at)} />
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/70 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="text-foreground font-medium break-words">{value}</dd>
    </div>
  );
}
