import { NIGHT_TIER_DOT_STYLES, NightSelector } from "@/components/booking/night-selector";
import { MapPinIcon } from "@/components/icons";
import {
  NIGHT_AVAILABILITY_TIER_ORDER,
  nightAvailabilityTier,
  nightAvailabilityTierLabel,
  type NightAvailabilityTier,
} from "@/lib/event-copy";
import { formatEventDate, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventNight } from "@/types";

type StepDatesProps = {
  nights: readonly EventNight[];
  value: string | null;
  onChange: (nightId: string) => void;
  /** Where the event runs — shown as the venue the picked slot belongs to. */
  venueName: string;
  city: string;
  error?: string;
  disabled?: boolean;
};

/**
 * Step 1 — pick the date and time together.
 *
 * The venue, the availability legend, the date cards and the time for the
 * chosen night live on one screen, matching the booking-flow reference.
 * Availability comes from the database: nights that are fully booked,
 * cancelled, finished or closed show their state but cannot be selected.
 */
export function StepDates({ nights, value, onChange, venueName, city, error, disabled }: StepDatesProps) {
  const selected = nights.find((night) => night.id === value) ?? null;
  const timeRange = selected ? formatTimeRange(selected.startTime, selected.endTime) : null;
  const tiers = nights.reduce<Set<NightAvailabilityTier>>((found, night) => {
    found.add(nightAvailabilityTier(night));
    return found;
  }, new Set<NightAvailabilityTier>());

  return (
    <div className="flex flex-col gap-6">
      {/* The venue the chosen slot belongs to — one event, one venue. */}
      <div className="flex flex-col gap-1.5">
        <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
          Selected venue
        </p>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <MapPinIcon className="text-marigold size-4 shrink-0" />
          {[venueName, city].filter(Boolean).join(", ") || "Venue to be announced"}
        </p>
      </div>

      {/* Availability legend: the dots the date cards carry, explained. */}
      <ul aria-label="Availability legend" className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {NIGHT_AVAILABILITY_TIER_ORDER.filter((tier) => tiers.has(tier)).map((tier) => (
          <li key={tier} className="text-muted flex items-center gap-1.5 text-xs font-medium">
            <span
              aria-hidden="true"
              className={cn("size-1.5 rounded-full", NIGHT_TIER_DOT_STYLES[tier])}
            />
            {nightAvailabilityTierLabel(tier)}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-semibold tracking-tight">Choose your date</h3>
        <NightSelector nights={nights} value={value} onChange={onChange} disabled={disabled} />
      </div>

      {/* The chosen night's slot. One night has one run of hours, so the slot is
          pre-selected with the date; the words come from the same row. */}
      <div aria-live="polite" className="flex flex-col gap-2.5">
        <h3 className="text-sm font-semibold tracking-tight">Choose your time</h3>
        {selected ? (
          <div className="flex flex-wrap gap-2.5">
            <span className="border-marigold/50 bg-marigold/10 text-marigold-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold">
              {timeRange ?? "Time to be announced"}
            </span>
            <span className="text-muted self-center text-xs">
              {formatEventDate(selected.date)}
            </span>
          </div>
        ) : (
          <p className="text-muted text-sm/6">
            Pick a date to see the night&apos;s timing. Fully booked and finished nights cannot be
            selected — message the organiser on WhatsApp if you need help.
          </p>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-rani-soft text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
