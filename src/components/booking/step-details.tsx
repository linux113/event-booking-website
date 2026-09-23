import { TextField } from "@/components/ui/field";
import { formatInr } from "@/lib/format";
import type { PassOption } from "@/types";
import type { BookingDetailsDraft, BookingFieldErrors } from "@/types/booking";

type StepDetailsProps = {
  pass: PassOption | null;
  details: BookingDetailsDraft;
  onChange: (field: keyof BookingDetailsDraft, value: string) => void;
  errors: BookingFieldErrors;
  /** Live estimate for the copy under the quantity fields (display only). */
  estimate: { subtotal: number; total: number } | null;
  currency: string;
  disabled?: boolean;
};

/**
 * Step 3 — who is booking and how many.
 *
 * The head count is derived from the pass composition (`quantity x people per
 * pass`) and kept in sync while the visitor does not override it — a pass admits
 * a fixed group, so the server rejects a mismatched number.
 */
export function StepDetails({
  pass,
  details,
  onChange,
  errors,
  estimate,
  currency,
  disabled,
}: StepDetailsProps) {
  const peoplePerPass = pass?.numberOfPeople ?? 1;
  const maxPerBooking = pass?.maxPerBooking ?? 1;

  return (
    <div className="flex flex-col gap-6">
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
          label="Email address"
          name="customerEmail"
          type="email"
          inputMode="email"
          value={details.customerEmail}
          onChange={(value) => onChange("customerEmail", value)}
          error={errors.customerEmail}
          hint="Where the booking confirmation is sent."
          autoComplete="email"
          placeholder="you@example.com"
          required
          disabled={disabled}
        />
      </div>

      <div className="border-border bg-surface/50 flex flex-col gap-5 rounded-2xl border p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">How many passes?</h3>
          <p className="text-muted text-xs/5">
            {pass
              ? `A ${pass.name} admits ${peoplePerPass} ${peoplePerPass === 1 ? "person" : "people"}, and up to ${maxPerBooking} can be booked at a time.`
              : "Choose a pass to see the group size it admits."}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Quantity (passes)"
            name="quantity"
            type="number"
            inputMode="numeric"
            value={details.quantity}
            onChange={(value) => onChange("quantity", value)}
            error={errors.quantity}
            hint={pass ? `1 – ${maxPerBooking}` : undefined}
            min={1}
            max={maxPerBooking}
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
                ? `Must be ${peoplePerPass} × quantity — the group this pass admits.`
                : undefined
            }
            min={peoplePerPass}
            required
            disabled={disabled}
          />
        </div>

        {estimate ? (
          <p className="text-muted border-border/70 border-t pt-4 text-sm">
            Estimated total{" "}
            <span className="text-foreground font-semibold">
              {formatInr(estimate.total, currency)}
            </span>{" "}
            <span className="text-muted/80">
              ({details.quantity} × {formatInr(pass?.priceInr ?? 0, currency)}). The server
              recalculates the final amount from the database price when you confirm.
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
