import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { formatEventDate, formatInr, formatTimestamp, formatTimeRange } from "@/lib/format";
import { lookupBookings, MIN_LOOKUP_LENGTH } from "@/lib/services/admin";

export const metadata: Metadata = {
  title: "Booking lookup",
  description: "Find a booking and see its payment and pass state.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type BookingsPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

/**
 * Booking lookup — the one operational screen every role shares.
 *
 * What changes with the role is the *shape of the answer*, not the layout of the
 * page. A staff member's request goes to the database with
 * `p_include_contact = false`, so the mobile number, the email address, the amount
 * and the Razorpay order id are never returned to this process at all — there is
 * nothing here to leak, and nothing to remember to hide. An admin sees them, because
 * `bookings:view_contact` says so.
 *
 * The search itself runs in Postgres (`admin_lookup_bookings`), which is the only
 * place with access to the booking table under these rules.
 */
export default async function BookingsPage({ searchParams }: BookingsPageProps) {
  const staff = await requirePermission("bookings:view");
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const includeContact = can(staff.role, "bookings:view_contact");

  const result = await lookupBookings(rawQuery, staff.role);

  if (!result.ok) {
    return (
      <ErrorState
        error={{
          kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: result.error.message,
        }}
        title="Booking lookup is unavailable"
      />
    );
  }

  const lookup = result.data;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Booking lookup</h1>
        <p className="text-muted text-sm/6">
          Search by booking reference, mobile number or the guest&apos;s name.
          {includeContact
            ? " You can see contact details and amounts for each booking."
            : " Contact details and amounts are hidden for your role — ask an admin if you need them."}
        </p>
      </div>

      <form method="get" className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="booking-query" className="sr-only">
          Booking reference, mobile number or guest name
        </label>
        <input
          id="booking-query"
          name="q"
          defaultValue={lookup?.query ?? ""}
          type="search"
          autoComplete="off"
          placeholder="DND202600001, 98123 45678, or Nisha Rao"
          className="border-border bg-background/60 placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 h-11 w-full rounded-xl border px-3.5 text-sm transition-colors focus:ring-2 focus:outline-none"
        />
        <button
          type="submit"
          className="bg-marigold text-marigold-foreground hover:bg-marigold-soft inline-flex h-11 shrink-0 items-center justify-center rounded-full px-6 text-sm font-semibold tracking-tight transition-colors sm:w-40"
        >
          Search
        </button>
      </form>

      {!lookup ? (
        <EmptyState
          title={rawQuery ? "Keep typing" : "Search for a booking"}
          description={
            rawQuery
              ? `Enter at least ${MIN_LOOKUP_LENGTH} characters — a single letter would match most of the event.`
              : "Find a guest by the reference on their confirmation, the number they booked with, or their name."
          }
        />
      ) : lookup.rows.length === 0 ? (
        <EmptyState
          title="No booking found"
          description={`Nothing matched “${lookup.query}”. Check the reference, or try the last four digits of the mobile number.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted text-xs">
            {lookup.rows.length} {lookup.rows.length === 1 ? "booking" : "bookings"} for “{lookup.query}”
          </p>

          <ul className="flex flex-col gap-3">
            {lookup.rows.map((row) => (
              <li key={row.bookingUuid} className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-mono text-sm font-semibold">{row.reference}</p>
                    <p className="font-semibold tracking-tight">{row.customerName}</p>
                    {row.customerMobile || row.customerEmail ? (
                      <p className="text-muted text-xs">
                        {[row.customerMobile, row.customerEmail].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={row.bookingStatus} tone={statusTone(row.bookingStatus)} />
                    <StatusPill label={row.paymentStatus} tone={statusTone(row.paymentStatus)} />
                    {row.totalAmount !== null ? (
                      <span className="text-sm font-semibold">{formatInr(row.totalAmount, row.currency)}</span>
                    ) : null}
                  </div>
                </div>

                <dl className="text-muted grid gap-x-6 gap-y-1.5 text-xs/5 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact
                    label="Night"
                    value={[formatEventDate(row.eventDate), formatTimeRange(row.startTime, row.endTime)]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <Fact
                    label="Pass"
                    value={`${row.passName}${row.passComposition ? ` (${row.passComposition})` : ""} × ${row.quantity}`}
                  />
                  <Fact label="People admitted" value={String(row.numberOfPeople)} />
                  <Fact
                    label="Passes"
                    value={
                      row.passesIssued === 0
                        ? "none issued — payment not confirmed"
                        : `${row.passesCheckedIn} of ${row.passesIssued} checked in`
                    }
                  />
                  <Fact label="Booked" value={formatTimestamp(row.createdAt)} />
                  {row.razorpayOrderId ? <Fact label="Razorpay order" value={row.razorpayOrderId} /> : null}
                </dl>

                {row.checkInTimes.length > 0 ? (
                  <p className="text-muted/80 text-xs">
                    Checked in {row.checkInTimes.map((time) => formatTimestamp(time)).join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
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

function statusTone(status: string): "go" | "warn" | "stop" {
  if (["confirmed", "paid"].includes(status)) {
    return "go";
  }

  if (["pending", "unpaid"].includes(status)) {
    return "warn";
  }

  return "stop";
}

function StatusPill({ label, tone }: { label: string; tone: "go" | "warn" | "stop" }) {
  const tones = {
    go: "border-peacock/40 bg-peacock/10 text-peacock-soft",
    warn: "border-marigold/40 bg-marigold/10 text-marigold-soft",
    stop: "border-rani/40 bg-rani/10 text-rani-soft",
  } as const;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-widest uppercase ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
