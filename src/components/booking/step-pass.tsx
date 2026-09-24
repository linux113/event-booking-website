import { Badge } from "@/components/ui/badge";
import { CalendarIcon, CheckIcon, MinusIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { passAgeCopy } from "@/lib/event-copy";
import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventNight, PassOption } from "@/types";

type StepPassProps = {
  passes: readonly PassOption[];
  /** The ticket currently in the booking, or null. */
  value: string | null;
  onChange: (passId: string) => void;
  /** How many of the selected ticket are in the booking (1 … maxPerBooking). */
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  /** The night picked in step 1, summarised at the top of the screen. */
  night: EventNight | null;
  currency: string;
  /** Goes back to the date & time screen ("Change"). */
  onEditDate: () => void;
  error?: string;
  disabled?: boolean;
};

/**
 * Step 2 — tickets and quantities on one screen.
 *
 * The slot picked on the previous screen stays visible at the top. Each ticket
 * card shows its database price and either an "Add" control or a stepper for
 * the quantity in the booking, bounded by the ticket's own per-booking limit.
 * A booking carries a single ticket type — adding another one switches the
 * booking to it — and a ticket taken off sale keeps its state with no control,
 * so nothing sold out can be chosen; the server checks all of this again.
 */
export function StepPass({
  passes,
  value,
  onChange,
  quantity,
  onQuantityChange,
  night,
  currency,
  onEditDate,
  error,
  disabled,
}: StepPassProps) {
  const selected = passes.find((pass) => pass.id === value) ?? null;
  const timeRange = night ? formatTimeRange(night.startTime, night.endTime) : null;
  const total = selected ? selected.priceInr * quantity : null;

  if (passes.length === 0) {
    return (
      <p className="text-muted text-sm">
        This event has no ticket categories yet. Message the organiser on WhatsApp for help.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Selected date & time summary. */}
      {night ? (
        <div className="border-border bg-surface/50 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
          <p className="flex min-w-0 items-center gap-2.5 text-sm font-semibold">
            <CalendarIcon className="text-marigold size-4 shrink-0" />
            <span className="truncate">
              {formatEventDate(night.date)}
              {timeRange ? ` · ${timeRange}` : ""}
            </span>
          </p>
          <button
            type="button"
            onClick={onEditDate}
            className="text-marigold-soft hover:text-marigold shrink-0 text-xs font-semibold underline-offset-4 hover:underline"
          >
            Change
          </button>
        </div>
      ) : null}

      <fieldset disabled={disabled}>
        <legend className="sr-only">Choose your tickets</legend>
        <ul className="flex flex-col gap-3">
          {passes.map((pass) => (
            <li key={pass.id}>
              <TicketRow
                pass={pass}
                currency={currency}
                selected={pass.id === value}
                quantity={pass.id === value ? quantity : 1}
                onAdd={() => onChange(pass.id)}
                onQuantityChange={onQuantityChange}
              />
            </li>
          ))}
        </ul>
      </fieldset>

      {/* Running total for the tickets in the booking. */}
      <div className="border-border/70 flex items-baseline justify-between gap-3 border-t pt-4">
        <p className="text-muted text-sm">
          {selected ? (
            <>
              {quantity} × {selected.name}{" "}
              <span className="text-muted/80">
                · admits {quantity * selected.numberOfPeople}{" "}
                {quantity * selected.numberOfPeople === 1 ? "person" : "people"}
              </span>
            </>
          ) : (
            "No tickets added yet"
          )}
        </p>
        <p className="text-lg font-bold tracking-tight">
          {total !== null ? formatInr(total, currency) : "—"}
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-rani-soft text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TicketRowProps = {
  pass: PassOption;
  currency: string;
  selected: boolean;
  quantity: number;
  onAdd: () => void;
  onQuantityChange: (quantity: number) => void;
};

/**
 * One ticket card: name, group it admits and price on the left, the Add control
 * or the quantity stepper on the right.
 */
function TicketRow({ pass, currency, selected, quantity, onAdd, onQuantityChange }: TicketRowProps) {
  const isAvailable = pass.availability.enabled;
  const age = passAgeCopy(pass);

  return (
    <div
      className={cn(
        "border-border bg-surface/60 flex items-center justify-between gap-4 rounded-2xl border p-4 transition-colors sm:p-5",
        selected && "border-marigold/60 bg-marigold/5",
        !isAvailable && "opacity-60 saturate-50",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <p className="text-sm font-semibold tracking-tight">{pass.name}</p>
          {selected ? (
            <span className="text-peacock-soft flex items-center gap-1 text-[0.6875rem] font-semibold tracking-wide uppercase">
              <CheckIcon className="size-3" /> Added
            </span>
          ) : !isAvailable ? (
            <Badge variant="neutral" className="px-2 py-0.5 text-[0.6875rem]">
              Not on sale
            </Badge>
          ) : null}
        </div>

        <p className="text-muted flex items-start gap-1.5 text-xs/5">
          <UsersIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Admits {pass.numberOfPeople} {pass.numberOfPeople === 1 ? "person" : "people"} · up to{" "}
            {pass.maxPerBooking} per booking{age ? ` · ${age}` : ""}
          </span>
        </p>

        <p className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tracking-tight">{formatInr(pass.priceInr, currency)}</span>
          <span className="text-muted text-xs">/ pass</span>
        </p>

        <p className="text-marigold-soft text-xs font-medium">{pass.composition}</p>
      </div>

      {isAvailable ? (
        selected ? (
          <QuantityStepper
            quantity={quantity}
            max={pass.maxPerBooking}
            name={pass.name}
            onChange={onQuantityChange}
          />
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="border-marigold/40 bg-marigold/10 text-marigold-soft hover:border-marigold/60 hover:bg-marigold/15 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-5 text-sm font-semibold transition-colors"
          >
            <PlusIcon className="size-4" />
            Add
          </button>
        )
      ) : null}
    </div>
  );
}

type QuantityStepperProps = {
  quantity: number;
  max: number;
  /** Ticket name, for the screen-reader group label. */
  name: string;
  onChange: (quantity: number) => void;
};

/** − / quantity / + control, bounded by the ticket's per-booking limit. */
function QuantityStepper({ quantity, max, name, onChange }: QuantityStepperProps) {
  return (
    <div
      role="group"
      aria-label={`${name} quantity`}
      className="border-marigold/40 bg-night/40 flex h-11 shrink-0 items-center rounded-full border"
    >
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        disabled={quantity <= 1}
        aria-label={`One fewer ${name}`}
        className="text-marigold-soft hover:text-marigold flex size-11 items-center justify-center rounded-l-full transition-colors disabled:pointer-events-none disabled:opacity-40"
      >
        <MinusIcon className="size-4" />
      </button>
      <span aria-live="polite" className="min-w-7 text-center text-sm font-bold tabular-nums">
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={quantity >= max}
        aria-label={`One more ${name}`}
        className="text-marigold-soft hover:text-marigold flex size-11 items-center justify-center rounded-r-full transition-colors disabled:pointer-events-none disabled:opacity-40"
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
