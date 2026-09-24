"use client";

import { nightAvailabilityTier, nightStateLabel, nightUnavailableReason } from "@/lib/event-copy";
import { formatEventDate, formatTimeOfDay } from "@/lib/format";
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

/** Dot colour shared by the date cards and the legend — one tier, one colour. */
export const NIGHT_TIER_DOT_STYLES: Record<string, string> = {
  available: "bg-peacock",
  "filling-fast": "bg-marigold",
  "sold-out": "bg-rani",
  closed: "bg-muted/60",
};

/**
 * Date picker for the checkout wizard's date & time step.
 *
 * Fully controlled: the wizard owns the selection so it can validate it, send it
 * to the server and keep it when the visitor steps back and forth. Fully booked,
 * cancelled and finished nights are disabled inputs with the reason attached —
 * they can never be selected, and the server checks availability again anyway.
 * The dates always wrap as a grid — two columns on a phone, three from small
 * screens up, four on wide ones — never a sideways-scrolling single line.
 */
export function NightSelector({ nights, value, onChange, disabled }: NightSelectorProps) {
  if (nights.length === 0) {
    return <p className="text-muted text-sm">No nights have been scheduled for this event yet.</p>;
  }

  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">Choose your date</legend>

      <ul className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3 xl:grid-cols-4">
        {nights.map((night) => (
          <li key={night.id} className="min-w-0">
            <NightOption night={night} selected={night.id === value} onSelect={() => onChange(night.id)} />
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

/** One date card: weekday, day, month, the night's start time and its status dot. */
function NightOption({ night, selected, onSelect }: NightOptionProps) {
  const isDisabled = !night.isBookable;
  const inputId = `night-${night.id}`;
  const reason = nightUnavailableReason(night);
  const tier = nightAvailabilityTier(night);
  const startTime = formatTimeOfDay(night.startTime);
  const parts = splitDate(night.date);

  return (
    <div
      className={cn(
        "border-border bg-surface/60 relative flex h-full flex-col rounded-2xl border p-3.5 transition-colors",
        selected && "border-marigold/60 bg-marigold/5 ring-marigold/30 ring-1",
        isDisabled && "opacity-60",
      )}
    >
      <input
        id={inputId}
        type="radio"
        name="event-night"
        value={night.id}
        checked={selected}
        disabled={isDisabled}
        onChange={onSelect}
        aria-describedby={isDisabled ? `${inputId}-reason` : undefined}
        aria-label={formatEventDate(night.date)}
        className="accent-marigold absolute top-3 right-3 size-4 disabled:cursor-not-allowed"
      />

      <label htmlFor={inputId} className={cn("block", isDisabled ? "cursor-not-allowed" : "cursor-pointer")}>
        {parts ? (
          <>
            <span className="text-muted flex items-center gap-1.5 pr-5 text-[0.6875rem] font-semibold tracking-widest uppercase">
              <span
                aria-hidden="true"
                className={cn("size-1.5 shrink-0 rounded-full", NIGHT_TIER_DOT_STYLES[tier])}
              />
              {parts.weekday}
            </span>
            <span className="mt-1 block text-2xl leading-none font-bold tracking-tight">{parts.day}</span>
            <span className="text-muted mt-1 block text-xs font-medium">{parts.monthYear}</span>
          </>
        ) : (
          // Unparsable date: the exact stored value is shown rather than re-invented.
          <span className="text-muted flex items-center gap-1.5 pr-5 text-xs font-semibold">
            <span
              aria-hidden="true"
              className={cn("size-1.5 shrink-0 rounded-full", NIGHT_TIER_DOT_STYLES[tier])}
            />
            {night.date}
          </span>
        )}

        <span className="text-muted mt-1.5 block text-xs">
          {isDisabled ? nightStateLabel(night) : startTime ? `From ${startTime}` : "Time to be announced"}
        </span>
        <span className="text-muted/80 mt-0.5 block text-[0.6875rem] leading-tight">
          {isDisabled ? reason : `${night.remaining} places left`}
        </span>
      </label>

      {isDisabled ? (
        <p id={`${inputId}-reason`} className="sr-only">
          {reason} — this night cannot be selected.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Split a night into the three words its card shows. Built from `Intl` parts
 * against a UTC anchor — the same rule the rest of the date formatting
 * follows, so a night never rolls into the wrong day by timezone.
 */
function splitDate(isoDate: string): { weekday: string; day: string; monthYear: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(isoDate ?? "");

  if (!match) {
    return null;
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const parts: Record<string, string> = {};

  for (const part of cardDateFormatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return {
    weekday: parts.weekday ?? "",
    day: parts.day ?? "",
    monthYear: `${parts.month ?? ""} ${parts.year ?? ""}`.trim(),
  };
}

const cardDateFormatter = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
