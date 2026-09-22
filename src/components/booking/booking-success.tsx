import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { CheckIcon, ClockIcon } from "@/components/icons";
import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import type { EventSummary } from "@/types";
import type { CreatedBooking } from "@/types/booking";

type BookingSuccessProps = {
  booking: CreatedBooking;
  event: EventSummary;
  onStartOver: () => void;
};

/**
 * Confirmation panel.
 *
 * Every number here comes from the server response, not from the form. The copy is
 * deliberately explicit that no payment has been taken: the booking is `pending`
 * and `unpaid`, and payment arrives with Razorpay in the next step.
 */
export function BookingSuccess({ booking, event, onStartOver }: BookingSuccessProps) {
  const timeRange = formatTimeRange(booking.startTime, booking.endTime);

  return (
    <div className="flex flex-col gap-6">
      <div className="border-peacock/40 bg-peacock/5 flex flex-col gap-4 rounded-2xl border p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="bg-peacock/15 text-peacock-soft flex size-10 items-center justify-center rounded-xl"
          >
            <CheckIcon className="size-5" />
          </span>
          <h2 className="text-lg font-semibold tracking-tight">
            {booking.reusedExisting
              ? "This booking was already created"
              : "Booking created — pending payment"}
          </h2>
        </div>

        <p className="text-muted text-sm/6">
          {booking.reusedExisting
            ? "Your earlier attempt already went through, so here is the same booking — nothing was duplicated."
            : "Keep this reference. The booking is recorded and waiting for payment."}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <p className="border-border bg-background/60 rounded-xl border px-4 py-2 font-mono text-lg font-semibold tracking-wide">
            {booking.reference}
          </p>
          <Badge variant="marigold">Booking {booking.status}</Badge>
          <Badge variant="neutral">Payment {booking.paymentStatus}</Badge>
        </div>
      </div>

      <dl className="border-border bg-surface/50 divide-border/60 grid divide-y rounded-2xl border sm:grid-cols-2 sm:divide-y-0">
        <Row label="Event" value={`${event.name} · ${event.venueName}, ${event.city}`} wide />
        <Row
          label="Night"
          value={`${formatEventDate(booking.eventDate)}${timeRange ? ` · ${timeRange}` : ""}`}
        />
        <Row label="Pass" value={`${booking.passName} — ${booking.passComposition ?? ""}`} />
        <Row
          label="Quantity"
          value={`${booking.quantity} ${booking.quantity === 1 ? "pass" : "passes"} · admits ${booking.numberOfPeople} ${booking.numberOfPeople === 1 ? "person" : "people"}`}
        />
        <Row label="Subtotal" value={formatInr(booking.subtotal, booking.currency)} />
        <Row label="Total" value={formatInr(booking.totalAmount, booking.currency)} strong />
      </dl>

      <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <ClockIcon className="text-marigold size-4" />
          What happens next
        </h3>
        <ol className="text-muted flex list-decimal flex-col gap-2 pl-5 text-sm/6">
          <li>
            Nothing has been charged: online payment is not live yet, so this booking is held as
            pending and unpaid.
          </li>
          <li>
            The organiser confirms pending bookings on WhatsApp. Your pass is issued only after
            payment is received and verified.
          </li>
          <li>
            Quote the reference <span className="text-foreground font-semibold">{booking.reference}</span>{" "}
            when you message or call.
          </li>
        </ol>

        <div className="flex flex-wrap gap-3 pt-1">
          <WhatsAppButton
            variant="full"
            size="sm"
            number={event.contactPhone?.replace(/[^0-9]/g, "")}
            message={`Hi! I have booked passes for the Navratri event. My booking reference is ${booking.reference}.`}
          />
          <Button onClick={onStartOver} variant="secondary" size="sm">
            Book another night
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  wide,
  strong,
}: {
  label: string;
  value: string;
  wide?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={wide ? "flex flex-col gap-0.5 p-5 sm:col-span-2" : "flex flex-col gap-0.5 p-5"}>
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
        {label}
      </dt>
      <dd className={strong ? "text-marigold-soft font-bold" : "text-sm font-medium"}>{value}</dd>
    </div>
  );
}
