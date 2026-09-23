import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";

import { PaymentAttentionList } from "@/components/admin/payment-attention-list";
import { PaymentEventsTable } from "@/components/admin/payment-events-table";
import { PaymentFilters } from "@/components/admin/payment-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  isPaymentFiltered,
  paiseToRupees,
  parsePaymentQuery,
  operationsPageCount,
  paymentsHref,
} from "@/lib/admin/operations";
import { pageSummary, pageWindow, type SearchParamsInput } from "@/lib/admin/bookings";
import { requirePermission } from "@/lib/auth/guard";
import { formatInr, formatTimestamp } from "@/lib/format";
import { getPaymentsSnapshot } from "@/lib/services/admin-operations";

export const metadata: Metadata = {
  title: "Payments",
  description: "What Razorpay reported for each booking, and the rows that need attention.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PaymentsPageProps = {
  searchParams: Promise<SearchParamsInput>;
};

/**
 * Payments — the gateway's side of every booking.
 *
 * Three panels, in the order an operator asks the questions:
 *
 *   1. **the counts** — how many deliveries arrived, what they were, and how much the
 *      gateway says was captured and refunded. Those two amounts come from the gateway's
 *      own payload, which is the point: they are the one number here that the site did
 *      not write down itself;
 *   2. **what needs attention** — the rows whose payment state contradicts the rest of
 *      the row, each with the reason and the action;
 *   3. **the delivery log** — every event, newest first, with the booking it belongs to
 *      where one can be identified, including the ones that match nothing.
 *
 * Nothing on this page can change a payment status, and that is a property of the
 * database rather than a decision this screen made: the guard trigger refuses an update
 * that a verified event is not behind (`PB007`). So the page shows evidence — event type,
 * outcome, amount, when it arrived, when it was processed — instead of offering a button
 * that could not honestly exist.
 *
 * Guarded by `payments:view` (admin and super admin). A staff member who types the URL is
 * sent to the dashboard with an explanation.
 */
export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const staff = await requirePermission("payments:view");
  const query = parsePaymentQuery(await searchParams);
  const result = await getPaymentsSnapshot(query);

  if (!result.ok) {
    return (
      <ErrorState
        error={{
          kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: result.error.message,
        }}
        title="The payment log is unavailable"
      />
    );
  }

  const { summary, attention, attentionTotal, events, includeContact } = result.data;
  const summaryLine = pageSummary(events.page, events.pageSize, events.total);
  const filtering = isPaymentFiltered(query);
  const pages = operationsPageCount(events.total);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Payments</h1>
        <p className="text-muted text-sm/6">
          What the gateway sent us, delivery by delivery, and what the site did about it. A payment status moves only
          when a verified Razorpay event says so — there is no control here that could change one by hand, in the UI or
          in the database.
          {includeContact ? "" : ""}
        </p>
      </div>

      {summary ? (
        <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
          <h2 className="text-sm font-semibold tracking-tight">The gateway&apos;s record</h2>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Deliveries received" value={String(summary.events_total)} hint="Every event the gateway sent, plus every checkout confirmation" />
            <Stat
              label="Confirmed"
              value={String(summary.events_confirmed)}
              hint="Deliveries that moved a booking to paid"
              tone="positive"
            />
            <Stat
              label="Awaiting a verified payment"
              value={String(summary.orders_awaiting)}
              hint="Bookings with a Razorpay order and nothing verified yet — abandoned checkouts, or a customer still paying"
              tone={summary.orders_awaiting > 0 ? "attention" : "default"}
            />
            <Stat
              label="Not acted on"
              value={String(summary.events_ignored + summary.events_duplicate)}
              hint={`${summary.events_ignored} ignored · ${summary.events_duplicate} duplicate deliveries`}
            />
          </dl>

          <dl className="text-muted grid gap-x-6 gap-y-1.5 text-xs/5 sm:grid-cols-2 lg:grid-cols-4">
            {includeContact ? (
              <>
                <Fact
                  label="Captured, per the gateway"
                  value={
                    summary.captured_paise === null
                      ? "—"
                      : formatInr(paiseToRupees(summary.captured_paise) ?? 0)
                  }
                />
                <Fact
                  label="Refunded, per the gateway"
                  value={
                    summary.refunded_paise === null
                      ? "—"
                      : formatInr(paiseToRupees(summary.refunded_paise) ?? 0)
                  }
                />
              </>
            ) : (
              <Fact label="Captured and refunded" value="Amounts are not included" />
            )}
            <Fact label="Failed deliveries" value={String(summary.events_failed)} />
            <Fact label="Refund deliveries" value={String(summary.events_refunded)} />
            <Fact
              label="Last delivery"
              value={summary.last_received_at ? formatTimestamp(summary.last_received_at) : "None yet"}
            />
          </dl>

          <p className="text-muted/80 text-xs/5">
            The captured and refunded figures are the amounts Razorpay reported in its own payloads, not the amounts
            stored on the bookings — which is why they are worth comparing with the bookings list when something looks
            wrong.
          </p>
        </section>
      ) : (
        <p className="border-border bg-surface/40 text-muted rounded-2xl border px-4 py-6 text-center text-sm/6">
          No gateway deliveries have been recorded yet. The first event will appear here as soon as Razorpay sends one —
          and a booking confirmed through the checkout callback appears even without a webhook.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Needs attention</h2>
          <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-wider uppercase">
            {attentionTotal === 0 ? "Nothing" : `${attention.length} of ${attentionTotal}`}
          </p>
        </div>
        <p className="text-muted text-xs/5">
          Rows whose payment state contradicts the rest of the row — a paid booking with no pass, a refunded booking
          with an active pass, a delivery we could not act on. Each one says what happened and what to do about it.
        </p>
        <PaymentAttentionList rows={attention} includeContact={includeContact} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Delivery log</h2>

        <PaymentFilters query={query} total={events.total} />

        {events.rows.length === 0 ? (
          filtering ? (
            <EmptyState
              title="No deliveries match these filters"
              description={
                <>
                  Nothing in the log matches the current search and filters.{" "}
                  <Link href={"/admin/payments" as Route} className="text-marigold-soft font-semibold hover:underline">
                    Clear them
                  </Link>{" "}
                  to see every delivery.
                </>
              }
            />
          ) : events.total > 0 ? (
            <EmptyState
              title="That page is past the end of the log"
              description={
                <>
                  The log holds {events.total} deliveries over {pages} {pages === 1 ? "page" : "pages"}, so this one is
                  empty.{" "}
                  <Link href={"/admin/payments" as Route} className="text-marigold-soft font-semibold hover:underline">
                    Back to the newest
                  </Link>
                  .
                </>
              }
            />
          ) : (
            <EmptyState
              title="No deliveries recorded yet"
              description="Every webhook the gateway sends and every checkout confirmation the site verifies is recorded here, with the outcome."
            />
          )
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-muted text-xs">{summaryLine ?? `${events.rows.length} deliveries`}</p>
              <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-wider uppercase">
                Page {events.page} of {pages}
              </p>
            </div>

            <PaymentEventsTable rows={events.rows} includeContact={includeContact} />

            {pages > 1 ? (
              <nav aria-label="Delivery log pages" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted text-xs">
                  Page {events.page} of {pages}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {events.page > 1 ? (
                    <Link
                      href={paymentsHref(query, { page: events.page - 1 }) as Route}
                      rel="prev"
                      className="border-border text-muted hover:text-foreground hover:border-marigold/50 inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors"
                    >
                      Prev
                    </Link>
                  ) : null}
                  {pageWindow(events.page, pages).map((number) => (
                    <Link
                      key={number}
                      href={paymentsHref(query, { page: number }) as Route}
                      aria-current={number === events.page ? "page" : undefined}
                      className={
                        number === events.page
                          ? "border-marigold/50 bg-marigold/10 text-marigold-soft inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-semibold"
                          : "border-border text-muted hover:text-foreground hover:border-marigold/50 inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-semibold transition-colors"
                      }
                    >
                      {number}
                    </Link>
                  ))}
                  {events.page < pages ? (
                    <Link
                      href={paymentsHref(query, { page: events.page + 1 }) as Route}
                      rel="next"
                      className="border-border text-muted hover:text-foreground hover:border-marigold/50 inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors"
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "positive" | "attention";
}) {
  const toneClass =
    tone === "positive"
      ? "border-peacock/40 bg-peacock/10"
      : tone === "attention"
        ? "border-marigold/35 bg-marigold/[0.07]"
        : "border-border bg-surface/50";

  return (
    <div className={`flex flex-col gap-1 rounded-2xl border p-4 ${toneClass}`}>
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-2xl font-bold tracking-tight tabular-nums">{value}</span>
        <span className="text-muted text-xs/5">{hint}</span>
      </dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/70 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="text-foreground font-medium break-words">{value}</dd>
    </div>
  );
}
