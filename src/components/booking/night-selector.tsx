"use client";

import { ClockIcon, UsersIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { formatEventDate, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventNight } from "@/types";

type NightSelectorProps = {
  nights: readonly EventNight[];
  /** Currently selected night id, or null. Controlled by the checkout wizard. */
  value: string | null;
  onChange: (nightId: string) => void;
  /** Disabled while a booking request is in flight. */
  disabled?: boolean;
};

/**
 * Night picker for the checkout wizard.
 *
 * Fully controlled: the wizard owns the selection so it can validate it, send it
 * to the server and keep it when the visitor steps back and forth. Fully booked,
 * cancelled and finished nights are disabled inputs with the reason attached —
 * they can never be selected, and the server checks availability again anyway.
 */
export function NightSelector({ nights, value, onChange, disabled }: NightSelectorProps) {
  if (nights.length === 0) {
    return (
      <p className="text-muted text-sm">
        No nights have been scheduled for this event yet.
      </p>
    );
  }

  return (
    <fieldset className="flex flex-col gap-4" disabled={disabled}>
      <legend className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
        Choose your night
      </legend>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {nights.map((night) => (
          <li key={night.id}>
            <NightOption
              night={night}
              selected={night.id === value}
              onSelect={() => onChange(night.id)}
            />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

type NightOptionProps = {
  night: EventNight;
  selected: boolean;
  onSelect: () => void;
};

function NightOption({ night, selected, onSelect }: NightOptionProps) {
  const timeRange = formatTimeRange(night.startTime, night.endTime);
  const isDisabled = !night.isBookable;
  const inputId = `night-${night.id}`;
  const reason = disabledReason(night);

  return (
    <div
      className={cn(
        "border-border bg-surface/60 relative flex h-full flex-col gap-2 rounded-2xl border p-4 transition-colors",
        selected && "border-marigold/60 bg-marigold/5",
        isDisabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <label
          htmlFor={inputId}
          className={cn(
            "text-sm font-semibold tracking-tight",
            isDisabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {formatEventDate(night.date)}
        </label>

        {night.isFullyBooked ? (
          <Badge variant="rani">Fully booked</Badge>
        ) : night.status === "cancelled" ? (
          <Badge variant="neutral">Cancelled</Badge>
        ) : night.status === "completed" ? (
          <Badge variant="neutral">Finished</Badge>
        ) : (
          <Badge variant="marigold">Available</Badge>
        )}
      </div>

      {timeRange ? (
        <p className="text-muted flex items-center gap-1.5 text-xs">
          <ClockIcon className="size-3.5" />
          {timeRange}
        </p>
      ) : null}

      {capacityCopy(night) ? (
        <p className="text-muted flex items-center gap-1.5 text-xs">
          <UsersIcon className="size-3.5" />
          {capacityCopy(night)}
        </p>
      ) : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <input
          id={inputId}
          type="radio"
          name="event-night"
          value={night.id}
          checked={selected}
          disabled={isDisabled}
          onChange={onSelect}
          aria-describedby={isDisabled ? `${inputId}-reason` : undefined}
          className="accent-marigold size-4 disabled:cursor-not-allowed"
        />
        <label
          htmlFor={inputId}
          className={cn(
            "text-xs font-medium",
            isDisabled ? "text-muted cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {isDisabled ? reason : "Select this night"}
        </label>
      </div>

      {isDisabled ? (
        <p id={`${inputId}-reason`} className="sr-only">
          {reason} — this night cannot be selected.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Capacity line for a night, or null when a remaining count would mislead.
 *
 * A cancelled or finished night keeps its capacity in the database, so printing
 * "1500 of 1500 places left" next to "Cancelled" would read as availability.
 */
function capacityCopy(night: EventNight): string | null {
  if (night.isFullyBooked) {
    return "No passes left for this night";
  }

  if (night.status === "cancelled" || night.status === "completed") {
    return null;
  }

  return `${night.remaining} of ${night.capacity} places left`;
}

function disabledReason(night: EventNight): string {
  if (night.isFullyBooked) {
    return "Fully booked";
  }

  if (night.status === "cancelled") {
    return "Cancelled";
  }

  if (night.status === "completed") {
    return "Finished";
  }

  return "Unavailable";
}
