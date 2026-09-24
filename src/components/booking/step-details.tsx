import { TextField } from "@/components/ui/field";
import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import type { EventNight, PassOption } from "@/types";
import type { BookingDetailsDraft, BookingFieldErrors } from "@/types/booking";

type StepDetailsProps = {
  pass: PassOption | null;
  /** The night from step 1, summarised so the details are never filled in blind. */
  night: EventNight | null;
  details: BookingDetailsDraft;
  onChange: (field: keyof BookingDetailsDraft, value: string) => void;
  errors: BookingFieldErrors;
  /** Live estimate for the summary strip (display only). */
  estimate: { subtotal: number; total: number } | null;
  currency: string;
  disabled?: boolean;
};

/**
 * Step 3 — who is booking.
 *
 * The ticket and the quantity were picked on the previous screens; what is left
 * here is the lead guest's name and mobile, used for the entry register and the
 * booking confirmation. The head count follows the ticket composition
 * (quantity × people per pass) and stays editable while it matches — a pass
 * admits a fixed group, so the server rejects a mismatched number.
 */
export function StepDetails({
  pass,
  night,
  details,
  onChange,
  errors,
  estimate,
  currency,
  disabled,
}: StepDetailsProps) {
  const peoplePerPass = pass?.numberOfPeople ?? 1;
  const timeRange = night ? formatTimeRange(night.startTime, night.endTime) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* What is being booked, in one strip: slot, ticket, quantity and total. */}
      {pass ? (
        <dl className="border-border bg-surface/50 divide-border/60 grid grid-cols-2 divide-x rounded-2xl border sm:grid-cols-4">
          <SummaryCell
            label="Date & time"
            value={night ? `${formatEventDate(night.date)}${timeRange ? ` · ${timeRange}` : ""}` : "—"}
          />
          <SummaryCell label="Ticket" value={pass.name} />
          <SummaryCell label="Quantity" value={`${details.quantity || "1"} × ${formatInr(pass.priceInr, currency)}`} />
          <SummaryCell label="Total" value={estimate ? formatInr(estimate.total, currency) : "—"} strong />
        </dl>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Full name"
          name="customerName"
          value={details.customerName}
          onChange={(value) => onChange("customerName", value)}
          error={errors.customerName}
          hint="The lead guest for the entry register."
          autoComplete="name"
          placeholder="Asha Patel"
          required
          disabled={disabled}
          className="sm:col-span-2"
        />

        <TextField
          label="Mobile number"
          name="customerMobile"
          type="tel"
          inputMode="numeric"
          value={details.customerMobile}
          onChange={(value) => onChange("customerMobile", value)}
          error={errors.customerMobile}
          hint="10-digit Indian mobile. We add +91 automatically."
          autoComplete="tel"
          placeholder="98123 45678"
          required
          disabled={disabled}
        />

        <TextField
          label="Number of people"
          name="numberOfPeople"
          type="number"
          inputMode="numeric"
          value={details.numberOfPeople}
          onChange={(value) => onChange("numberOfPeople", value)}
          error={errors.numberOfPeople}
          hint={
            pass
              ? `${peoplePerPass} ${peoplePerPass === 1 ? "person" : "people"} per pass × quantity — the group this booking admits.`
              : "The group this booking admits."
          }
          min={peoplePerPass}
          required
          disabled={disabled}
        />

        <TextField
          label="Referral name (optional)"
          name="referredBy"
          value={details.referredBy ?? ""}
          onChange={(value) => onChange("referredBy", value)}
          error={errors.referredBy}
          hint="If a friend, promoter, or affiliate referred you, enter their name here."
          placeholder="e.g. Rahul Sharma"
          disabled={disabled}
          className="sm:col-span-2"
        />
      </div>
    </div>
  );
}

function SummaryCell({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className={strong ? "text-marigold-soft text-sm font-bold" : "text-sm font-medium"}>{value}</dd>
    </div>
  );
}
