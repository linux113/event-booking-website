import { NightSelector } from "@/components/booking/night-selector";
import { CheckIcon } from "@/components/icons";
import { formatEventDate, formatTimeRange } from "@/lib/format";
import type { EventNight } from "@/types";

type StepDatesProps = {
  nights: readonly EventNight[];
  value: string | null;
  onChange: (nightId: string) => void;
  error?: string;
  disabled?: boolean;
};

/** Step 1 — pick the night. Availability comes from the database. */
export function StepDates({ nights, value, onChange, error, disabled }: StepDatesProps) {
  const selected = nights.find((night) => night.id === value) ?? null;
  const bookable = nights.filter((night) => night.isBookable).length;
  const timeRange = selected ? formatTimeRange(selected.startTime, selected.endTime) : null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted text-sm/6">
        {bookable} of {nights.length} nights can be booked right now. Fully booked, cancelled and
        finished nights are shown for reference but cannot be selected.
      </p>

      <NightSelector
        nights={nights}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />

      <p aria-live="polite" className="text-sm">
        {selected ? (
          <span className="text-peacock-soft inline-flex flex-wrap items-center gap-2">
            <CheckIcon className="size-4" />
            <span className="font-semibold">
              {formatEventDate(selected.date)}
              {timeRange ? ` · ${timeRange}` : ""}
            </span>
            <span className="text-muted">
              {selected.remaining} of {selected.capacity} places left · selected
            </span>
          </span>
        ) : (
          <span className="text-muted">
            Pick a night to continue. Every night is currently unavailable — message the organiser
            on WhatsApp and they will help.
          </span>
        )}
      </p>

      {error ? (
        <p role="alert" className="text-rani-soft text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
