import { PassList } from "@/components/pass/pass-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { CalendarIcon, CheckIcon, ClockIcon, UsersIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { formatEventDate, formatInr, formatTimeRange, formatTimestamp } from "@/lib/format";
import type { BookingStatusView } from "@/types/booking";
import type { DigitalPassSummary } from "@/types/pass";

type BookingConfirmationProps = {
  booking: BookingStatusView;
  /**
   * The event's WhatsApp link, already carrying this booking's reference. Built by the
   * page from the event row, so the panel needs to know nothing about phone numbers.
   */
  whatsappHref?: string | null;
  /**
   * The passes issued for this booking, when the caller has them. Each row links to
   * its own pass page (and to its download), so the confirmation is also the way
   * back to the QR codes; the panel itself never creates one.
   */
  passes?: DigitalPassSummary[];
  className?: string;
};

/**
 * The one confirmation panel, used by the server-rendered booking status page.
 *
 * Everything it shows comes from the database — the amount is the stored
 * `total_amount`, the passes are the rows that were issued, the statuses are the
 * real `booking_status` / `payment_status` columns. The panel therefore renders
 * the same thing after a refresh, after a webhook confirmed the payment, or when
 * a customer opens the link on their phone later.
 *
 * It never claims a payment that is not recorded: "payment successful" only
 * appears for a booking the server has marked paid.
 */
export function BookingConfirmation({ booking, passes = [], whatsappHref = null, className }: BookingConfirmationProps) {
  const timeRange = formatTimeRange(booking.startTime, booking.endTime);
  const isPaid = booking.status === "confirmed" && booking.paymentStatus === "paid";
  const isRefunded = booking.status === "refunded" || booking.paymentStatus === "refunded";
  const hasFailed = booking.paymentStatus === "failed";

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div
        className={cn(
          "flex flex-col gap-4 rounded-2xl border p-6",
          isPaid && "border-peacock/40 bg-peacock/5",
          isRefunded && "border-rani/40 bg-rani/5",
          !isPaid && !isRefunded && "border-marigold/40 bg-marigold/8",
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-10 items-center justify-center rounded-xl",
              isPaid && "bg-peacock/15 text-peacock-soft",
              isRefunded && "bg-rani/15 text-rani-soft",
              !isPaid && !isRefunded && "bg-marigold/15 text-marigold-soft",
            )}
          >
            {isPaid ? <CheckIcon className="size-5" /> : <ClockIcon className="size-5" />}
          </span>
          <h2 className="text-lg font-semibold tracking-tight">
            {isPaid
              ? "Payment successful — your booking is confirmed"
              : isRefunded
                ? "This booking was refunded"
                : hasFailed
                  ? "That payment did not go through"
                  : "Booking held — payment not completed"}
          </h2>
        </div>

        <p className="text-muted text-sm/6">
          {isPaid
            ? `We verified a payment of ${formatInr(booking.totalAmount, booking.currency)} with the payment gateway, so your booking is confirmed and your passes are issued.`
            : isRefunded
              ? "The payment for this booking was refunded, so the booking and its passes are no longer valid. Nothing else is owed."
              : hasFailed
                ? "The payment was declined or cancelled, so this booking is still waiting for payment. Nothing has been charged against this booking."
                : "This booking is recorded but no completed payment has been verified for it yet. Nothing has been charged."}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <p className="border-border bg-background/60 rounded-xl border px-4 py-2 font-mono text-lg font-semibold tracking-wide">
            {booking.reference}
          </p>
          <Badge variant={isPaid ? "marigold" : "neutral"}>Booking {booking.status}</Badge>
          <Badge variant="neutral">Payment {booking.paymentStatus === "paid" ? "paid" : booking.paymentStatus}</Badge>
        </div>

        {isPaid && booking.passesIssued > 0 ? (
          <p className="text-peacock-soft flex items-center gap-2 text-sm font-semibold">
            <CheckIcon className="size-4" />
            {booking.passesIssued} {booking.passesIssued === 1 ? "entry pass is" : "entry passes are"} issued
            against this booking.
          </p>
        ) : null}
      </div>

      {passes.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold tracking-tight">
            {passes.length === 1 ? "Your digital pass" : `Your ${passes.length} digital passes`}
          </h3>
          <PassList passes={passes} />
        </div>
      ) : null}

      <dl className="border-border bg-surface/50 divide-border/60 grid divide-y rounded-2xl border sm:grid-cols-2 sm:divide-y-0">
        <Row
          label="Event"
          value={`${booking.eventName} · ${booking.venueName}, ${booking.city}`}
          wide
        />
        <Row
          label="Night"
          value={`${formatEventDate(booking.eventDate)}${timeRange ? ` · ${timeRange}` : ""}`}
        />
        <Row label="Pass" value={`${booking.passName}${booking.passComposition ? ` — ${booking.passComposition}` : ""}`} />
        <Row
          label="Quantity"
          value={`${booking.quantity} ${booking.quantity === 1 ? "pass" : "passes"} · admits ${booking.numberOfPeople} ${
            booking.numberOfPeople === 1 ? "person" : "people"
          }`}
        />
        <Row
          label={isPaid ? "Amount paid" : "Amount due"}
          value={formatInr(booking.totalAmount, booking.currency)}
          strong
        />
      </dl>

      <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <CalendarIcon className="text-marigold size-4" />
          What happens next
        </h3>

        {isPaid ? (
          <ul className="text-muted flex flex-col gap-2.5 text-sm/6">
            <li className="flex items-start gap-2.5">
              <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
              Bring this booking reference and a photo ID for the lead guest to the gate.
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
              Your passes are scanned at the entrance — one scan per pass.
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
              Keep this page: refreshing it always shows the live status of this booking.
            </li>
          </ul>
        ) : (
          <ul className="text-muted flex flex-col gap-2.5 text-sm/6">
            <li className="flex items-start gap-2.5">
              <CheckIcon className="text-marigold mt-0.5 size-4 shrink-0" />
              No passes have been issued for this booking yet.
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="text-marigold mt-0.5 size-4 shrink-0" />
              If you have just paid, wait a few seconds and refresh this page — the payment is confirmed by our
              server, not by the browser.
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="text-marigold mt-0.5 size-4 shrink-0" />
              If payment keeps failing, message the organiser with the reference {booking.reference}.
            </li>
          </ul>
        )}

        <div className="flex flex-wrap gap-3 pt-1">
          {isPaid || isRefunded ? (
            <Button href="/book" variant="secondary" size="sm">
              Book another night
            </Button>
          ) : (
            <Button href="/book" size="sm">
              Complete payment
            </Button>
          )}

          <WhatsAppButton href={whatsappHref} variant="full" size="sm" />
        </div>
      </div>

      <p className="text-muted/80 flex items-center gap-2 text-xs">
        <UsersIcon className="size-3.5" />
        Booking {booking.reference} · created {formatTimestamp(booking.createdAt)}
      </p>
    </div>
  );
}

function Row({ label, value, wide, strong }: { label: string; value: string; wide?: boolean; strong?: boolean }) {
  return (
    <div className={wide ? "flex flex-col gap-0.5 p-5 sm:col-span-2" : "flex flex-col gap-0.5 p-5"}>
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className={strong ? "text-marigold-soft font-bold" : "text-sm font-medium"}>{value}</dd>
    </div>
  );
}
