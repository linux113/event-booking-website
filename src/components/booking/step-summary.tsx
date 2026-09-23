import { Button } from "@/components/ui/button";
import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import type { EventNight, EventSummary, PassOption } from "@/types";
import type { BookingApiError, BookingDetailsDraft, BookingStep, PaymentPhase } from "@/types/booking";

type StepSummaryProps = {
  event: EventSummary;
  night: EventNight | null;
  pass: PassOption | null;
  details: BookingDetailsDraft;
  /** Estimate shown before paying; the server's own total is what Razorpay charges. */
  estimate: { subtotal: number; total: number } | null;
  currency: string;
  phase: PaymentPhase;
  /** False when the server has no Razorpay keys — the booking is then held, unpaid. */
  paymentsReady: boolean;
  /** `"test"` when the configured Razorpay key is a test key. */
  paymentMode: "test" | "live" | null;
  /** A rejected request (validation, capacity, a refused booking). */
  error: BookingApiError | null;
  /** Something the customer should know that is not an error, e.g. a closed window. */
  notice: string | null;
  onSubmit: () => void;
  onEdit: (step: BookingStep) => void;
};

const BUTTON_LABELS: Record<PaymentPhase, string> = {
  editing: "",
  creating: "Starting the payment…",
  paying: "Waiting for the payment window…",
  verifying: "Verifying the payment…",
};

/**
 * Step 4 — the review, and the point where money changes hands.
 *
 * The totals shown here are the database price for the chosen pass; the amount
 * actually charged is the one the server writes onto the booking and passes to
 * Razorpay, so nothing on this page can change the price. Card and UPI details are
 * entered in Razorpay's own window — they never touch this site, and the booking is
 * only confirmed after the server has verified the payment.
 */
export function StepSummary({
  event,
  night,
  pass,
  details,
  estimate,
  currency,
  phase,
  paymentsReady,
  paymentMode,
  error,
  notice,
  onSubmit,
  onEdit,
}: StepSummaryProps) {
  const timeRange = night ? formatTimeRange(night.startTime, night.endTime) : null;
  const isBusy = phase !== "editing";
  const total = estimate ? formatInr(estimate.total, currency) : null;

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
            {paymentsReady ? "Total payable" : "Amount due"}
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
              Fix the highlighted fields and confirm again — nothing has been booked or charged yet.
            </p>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="border-marigold/40 bg-marigold/8 flex flex-col gap-1.5 rounded-2xl border p-5"
        >
          <p className="text-marigold-soft text-sm font-semibold">{notice}</p>
        </div>
      ) : null}

      {phase === "paying" ? (
        <div
          role="status"
          className="border-border bg-surface/50 flex flex-col gap-1.5 rounded-2xl border p-5"
        >
          <p className="text-sm font-semibold">Razorpay Checkout is open</p>
          <p className="text-muted text-xs">
            Finish the payment in that window. If you close it, nothing is charged and this booking stays held
            with the same reference.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onSubmit}
            disabled={isBusy}
            size="lg"
            className="w-full sm:w-auto"
            aria-busy={isBusy}
          >
            {isBusy
              ? BUTTON_LABELS[phase]
              : paymentsReady && total
                ? `Pay ${total} securely`
                : "Confirm booking"}
          </Button>
          <Button href="/passes" variant="secondary" size="lg" className="w-full sm:w-auto">
            Compare passes
          </Button>
        </div>

        <p className="text-muted text-xs/5">
          {paymentsReady ? (
            <>
              Confirming creates the booking <strong className="font-semibold">pending</strong> and opens
              Razorpay Checkout for the amount above. The payment is verified on our server before the booking
              becomes <strong className="font-semibold">confirmed</strong>, and passes are issued only then.
              {paymentMode === "test" ? (
                <>
                  {" "}
                  This deployment runs on <strong className="font-semibold">Razorpay test keys</strong>, so no
                  real money moves.
                </>
              ) : null}
            </>
          ) : (
            <>
              Online payment is not configured on this deployment, so confirming holds the booking as{" "}
              <strong className="font-semibold">pending</strong> and{" "}
              <strong className="font-semibold">unpaid</strong>. Nothing is charged on this website and no card
              or UPI details are collected — the organiser takes payment directly and issues the pass after
              that.
            </>
          )}
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
