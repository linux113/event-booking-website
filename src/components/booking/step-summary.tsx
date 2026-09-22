import { Button } from "@/components/ui/button";
import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import type { EventNight, EventSummary, PassOption } from "@/types";
import type { BookingApiError, BookingDetailsDraft, BookingStep } from "@/types/booking";

type StepSummaryProps = {
  event: EventSummary;
  night: EventNight | null;
  pass: PassOption | null;
  details: BookingDetailsDraft;
  /** Estimate shown before submitting; the server returns the authoritative one. */
  estimate: { subtotal: number; total: number } | null;
  currency: string;
  status: "editing" | "submitting";
  error: BookingApiError | null;
  onSubmit: () => void;
  onEdit: (step: BookingStep) => void;
};

/**
 * Step 4 — the booking summary.
 *
 * Shows exactly what will be sent: event, date, pass, quantity, subtotal and
 * total. The totals here are an estimate rendered from the database price; the
 * numbers the customer keeps come back from the server after the booking is
 * created, so a stale tab cannot create a booking at an old price.
 */
export function StepSummary({
  event,
  night,
  pass,
  details,
  estimate,
  currency,
  status,
  error,
  onSubmit,
  onEdit,
}: StepSummaryProps) {
  const timeRange = night ? formatTimeRange(night.startTime, night.endTime) : null;
  const isSubmitting = status === "submitting";

  return (
    <div className="flex flex-col gap-6">
      <dl className="border-border bg-surface/50 divide-border/60 grid divide-y rounded-2xl border sm:grid-cols-2 sm:divide-y-0">
        <div className="flex flex-col gap-0.5 p-5 sm:col-span-2">
          <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
            Event
          </dt>
          <dd className="font-semibold">
            {event.name}
            <span className="text-muted font-normal">
              {" "}
              · {event.venueName}, {event.city}
            </span>
          </dd>
        </div>

        <SummaryRow
          label="Date"
          value={
            night
              ? `${formatEventDate(night.date)}${timeRange ? ` · ${timeRange}` : ""}`
              : "No night selected"
          }
          onEdit={() => onEdit(1)}
        />

        <SummaryRow
          label="Pass"
          value={pass ? `${pass.name} — ${pass.composition}` : "No pass selected"}
          onEdit={() => onEdit(2)}
        />

        <SummaryRow label="Quantity" value={`${details.quantity || "0"} passes`} onEdit={() => onEdit(3)} />

        <SummaryRow
          label="People admitted"
          value={`${details.numberOfPeople || "0"} ${details.numberOfPeople === "1" ? "person" : "people"}`}
          onEdit={() => onEdit(3)}
        />

        <div className="flex flex-col gap-0.5 p-5">
          <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
            Subtotal
          </dt>
          <dd className="font-semibold">{estimate ? formatInr(estimate.subtotal, currency) : "—"}</dd>
        </div>

        <div className="flex flex-col gap-0.5 p-5">
          <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
            Total payable
          </dt>
          <dd className="text-marigold-soft text-lg font-bold">
            {estimate ? formatInr(estimate.total, currency) : "—"}
          </dd>
        </div>

        <div className="flex flex-col gap-0.5 p-5 sm:col-span-2">
          <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
            Booking contact
          </dt>
          <dd className="text-sm">
            {details.customerName || "—"}
            <span className="text-muted">
              {" "}
              · {details.customerMobile || "—"} · {details.customerEmail || "—"}
            </span>
          </dd>
          <button
            type="button"
            onClick={() => onEdit(3)}
            className="text-marigold-soft hover:text-marigold mt-2 w-fit text-xs font-semibold underline-offset-4 hover:underline"
          >
            Edit details
          </button>
        </div>
      </dl>

      {error ? (
        <div
          role="alert"
          className="border-rani/40 bg-rani/5 flex flex-col gap-1.5 rounded-2xl border p-5"
        >
          <p className="text-rani-soft text-sm font-semibold">{error.message}</p>
          {error.fieldErrors ? (
            <p className="text-muted text-xs">
              Fix the highlighted fields and confirm again — nothing has been booked yet.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onSubmit}
            disabled={isSubmitting}
            size="lg"
            className="w-full sm:w-auto"
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Creating your booking…" : "Confirm booking"}
          </Button>
          <Button href="/passes" variant="secondary" size="lg" className="w-full sm:w-auto">
            Compare passes
          </Button>
        </div>

        <p className="text-muted text-xs/5">
          Confirming creates a booking with status <strong className="font-semibold">pending</strong> and
          payment <strong className="font-semibold">not paid</strong>. Online payment is not live yet, so
          nothing is charged on this website and no card or UPI details are collected.
        </p>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-5">
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
          {label}
        </dt>
        <dd className="text-sm font-medium">{value}</dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-marigold-soft hover:text-marigold shrink-0 text-xs font-semibold underline-offset-4 hover:underline"
      >
        Change
      </button>
    </div>
  );
}
