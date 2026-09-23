import { StatusPill, statusTone } from "@/components/admin/status-pill";
import {
  checkInSummary,
  type BookingCheckIn,
  type BookingDetail,
  type BookingPass,
  type BookingPaymentEvent,
} from "@/lib/admin/bookings";
import { formatEventDate, formatInr, formatTimeRange, formatTimestamp } from "@/lib/format";

/**
 * One booking, in full.
 *
 * Laid out as the questions an operator actually asks when a guest is standing in front
 * of them, in that order: *who is this and what did they buy* → *which night* → *has it
 * been paid* → *which passes exist and where are they* → *what did the gateway say*.
 *
 * Two things about this panel are deliberate:
 *
 *   * **There is no control that changes a payment status.** Not a disabled button, not
 *     a hidden one — none, because the database refuses such a write (`PB007`) unless it
 *     comes from a verified Razorpay event. The panel shows the evidence instead: the
 *     gateway's own events, with the times they were received and the outcome the site
 *     recorded. That is the "clearly defined secure administrative process" — re-deliver
 *     the gateway's event, do not type a status.
 *   * **When contact is omitted, the panel arrives with the money and the
 *     contact details already absent.** The sections below render a short explanation
 *     rather than blanks, so nobody is left guessing whether a value is missing or
 *     hidden.
 */
export function BookingDetailPanel({
  booking,
  includeContact,
}: {
  booking: BookingDetail;
  includeContact: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-sm font-semibold">{booking.reference}</p>
            <h2 className="text-xl font-bold tracking-tight">{booking.customerName}</h2>
            <p className="text-muted text-sm/6">
              {booking.passName}
              {booking.passComposition ? ` (${booking.passComposition})` : ""} × {booking.quantity} —{" "}
              {booking.numberOfPeople} {booking.numberOfPeople === 1 ? "person" : "people"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={booking.paymentStatus} tone={statusTone(booking.paymentStatus)} />
            <StatusPill label={booking.bookingStatus} tone={statusTone(booking.bookingStatus)} />
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact
            label="Night"
            value={[formatEventDate(booking.eventDate), formatTimeRange(booking.startTime, booking.endTime)]
              .filter(Boolean)
              .join(" · ")}
          />
          <Fact label="Event" value={booking.eventName} />
          <Fact
            label="Venue"
            value={[booking.venueName, booking.venueAddress, booking.city].filter(Boolean).join(", ") || "—"}
          />
          {includeContact ? (
            <>
              <Fact label="Mobile" value={booking.customerMobile ?? "—"} />
            </>
          ) : null}
          <Fact label="Booked" value={formatTimestamp(booking.createdAt)} />
          <Fact label="Last updated" value={formatTimestamp(booking.updatedAt)} />
          <Fact
            label="Check-in"
            value={checkInSummary({
              passesIssued: booking.passes.length,
              passesCheckedIn: booking.passes.filter((pass) => pass.checkedIn).length,
              paymentStatus: booking.paymentStatus,
            })}
          />
          {includeContact ? <Fact label="Notes" value={booking.notes?.trim() || "—"} /> : null}
        </dl>
      </section>

      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">Payment</h3>
          <p className="text-muted text-xs/5">
            The status above is set by Razorpay&apos;s own events, verified by signature before they are recorded. It
            cannot be changed from this screen — if the gateway captured a payment the site missed, resend that event
            from the Razorpay dashboard and the status follows.
          </p>
        </div>

        {includeContact ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact
              label="Amount"
              value={booking.totalAmount === null ? "—" : formatInr(booking.totalAmount, booking.currency)}
            />
            <Fact
              label="Before tax"
              value={booking.subtotal === null ? "—" : formatInr(booking.subtotal, booking.currency)}
            />
            <Fact label="Razorpay order" value={booking.razorpayOrderId ?? "—"} />
            <Fact label="Razorpay payment" value={booking.razorpayPaymentId ?? "—"} />
          </dl>
        ) : (
          <p className="text-muted border-border/70 bg-background/40 rounded-xl border px-4 py-3 text-xs/5">
            Amounts and Razorpay IDs are not included. The payment status itself is visible above, because it
            decides whether a guest can be admitted.
          </p>
        )}

        {includeContact ? <PaymentEvents events={booking.paymentEvents} currency={booking.currency} /> : null}
      </section>

      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">Passes</h3>
          <p className="text-muted text-xs/5">
            One row per pass issued for this booking. A pass is created only after a payment is verified, and it admits
            once — the QR code itself is not shown here, because the token that opens the gate is not something a screen
            should hand out.
          </p>
        </div>

        {booking.passes.length === 0 ? (
          <p className="text-muted border-border/70 bg-background/40 rounded-xl border px-4 py-6 text-center text-sm/6">
            No pass has been issued for this booking. Passes are created when the payment is confirmed
            {booking.paymentStatus === "paid" ? " — this one is marked paid, so check the gateway events above." : "."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {booking.passes.map((pass) => (
              <PassRow key={pass.passId} pass={pass} />
            ))}
          </ul>
        )}

        {booking.checkIns.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">Gate entries</h4>
            <ul className="flex flex-col gap-1.5">
              {booking.checkIns.map((entry) => (
                <CheckInRow key={`${entry.passId}-${entry.checkedInAt}`} entry={entry} />
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PassRow({ pass }: { pass: BookingPass }) {
  return (
    <li className="border-border/70 bg-background/40 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs font-semibold">{pass.passId}</span>
        <span className="text-muted text-[0.6875rem]">
          Pass {pass.passNumber} · valid {formatEventDate(pass.validDate)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <StatusPill label={pass.status} tone={statusTone(pass.status)} />
        <span className="text-muted text-xs">
          {pass.checkedIn ? `In${pass.checkedInAt ? ` · ${formatTimestamp(pass.checkedInAt)}` : ""}` : "Not in yet"}
        </span>
      </div>
    </li>
  );
}

function CheckInRow({ entry }: { entry: BookingCheckIn }) {
  return (
    <li className="text-muted flex flex-wrap gap-x-2 text-xs/5">
      <span className="text-foreground font-medium">{entry.passId}</span>
      <span>· {formatTimestamp(entry.checkedInAt)}</span>
      {entry.gate ? <span>· {entry.gate}</span> : null}
      <span>· admitted by {entry.staff ?? "an unknown account"}</span>
      {entry.notes ? <span>· {entry.notes}</span> : null}
    </li>
  );
}

/**
 * What the gateway reported for this order.
 *
 * The outcome is shown as recorded, in the past tense the site wrote it in: `paid`,
 * `failed`, `refunded`, `ignored`. A duplicate delivery and the action taken about it
 * are visible here, which is how an operator answers "the webhook fired twice, did we
 * hand out two passes?" without reading a log file.
 */
function PaymentEvents({ events, currency }: { events: readonly BookingPaymentEvent[]; currency: string }) {
  if (events.length === 0) {
    return (
      <p className="text-muted border-border/70 bg-background/40 rounded-xl border px-4 py-4 text-xs/5">
        No webhook delivery has been recorded for this order. That is not the same as an unverified payment: a booking
        can be confirmed by the signature-checked callback the checkout returns, which is reported to Razorpay and
        verified there and then, without Razorpay ever sending us a webhook. An unpaid booking has neither, which is
        also normal.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">Razorpay events received for this booking&apos;s order</caption>
        <thead>
          <tr className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
            <th scope="col" className="border-border/60 border-b py-2 pr-4">
              Event
            </th>
            <th scope="col" className="border-border/60 border-b py-2 pr-4">
              Outcome
            </th>
            <th scope="col" className="border-border/60 border-b py-2 pr-4">
              Amount
            </th>
            <th scope="col" className="border-border/60 border-b py-2 pr-4">
              Received
            </th>
            <th scope="col" className="border-border/60 border-b py-2">
              Processed
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.eventId} className="border-border/60 border-b last:border-b-0">
              <td className="py-2 pr-4 font-mono">{event.eventType}</td>
              <td className="py-2 pr-4">
                <StatusPill label={event.outcome} tone={statusTone(event.outcome)} />
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {event.amountPaise === null ? "—" : formatInr(Math.round(event.amountPaise / 100), currency)}
              </td>
              <td className="text-muted py-2 pr-4 whitespace-nowrap">{formatTimestamp(event.receivedAt)}</td>
              <td className="text-muted py-2 whitespace-nowrap">
                {event.processedAt ? formatTimestamp(event.processedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/70 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="text-foreground text-sm font-medium break-words">{value}</dd>
    </div>
  );
}
