import { ClockIcon, UsersIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { nightAvailabilityCopy, nightStateLabel } from "@/lib/event-copy";
import { formatEventDate, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventNight } from "@/types";

type NightListProps = {
  nights: readonly EventNight[];
  className?: string;
};

/**
 * Every night of the festival with its availability.
 *
 * Fully booked and cancelled nights are shown — never hidden — with the reason
 * spelled out, so a visitor is not left wondering why a date is missing.
 * Server component: no interactivity, no client JS.
 */
export function NightList({ nights, className }: NightListProps) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {nights.map((night) => (
        <li key={night.id}>
          <NightCard night={night} />
        </li>
      ))}
    </ul>
  );
}

export function NightCard({ night }: { night: EventNight }) {
  const timeRange = formatTimeRange(night.startTime, night.endTime);
  const isCancelled = night.status === "cancelled";

  return (
    <div
      className={cn(
        "border-border bg-surface/60 flex h-full flex-col gap-3 rounded-2xl border p-5",
        night.isFullyBooked && "border-rani/45",
        isCancelled && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold tracking-tight">{formatEventDate(night.date)}</p>
        <StatusBadge night={night} />
      </div>

      {timeRange ? (
        <p className="text-muted flex items-center gap-1.5 text-xs">
          <ClockIcon className="size-3.5" />
          {timeRange}
        </p>
      ) : null}

      {nightAvailabilityCopy(night) ? (
        <p className="text-muted mt-auto flex items-center gap-1.5 text-xs">
          <UsersIcon className="size-3.5" />
          {nightAvailabilityCopy(night)}
        </p>
      ) : null}

      {!night.isBookable ? (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-center text-[0.6875rem] font-bold tracking-widest uppercase",
            night.isFullyBooked ? "bg-rani/12 text-rani-soft" : "bg-surface-raised/60 text-muted",
          )}
        >
          {nightStateLabel(night)}
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ night }: { night: EventNight }) {
  if (night.isFullyBooked) {
    return <Badge variant="rani">Fully booked</Badge>;
  }

  if (night.status === "cancelled" || night.status === "completed" || !night.isBookingOpen) {
    return <Badge variant="neutral">{nightStateLabel(night)}</Badge>;
  }

  return <Badge variant="marigold">Available</Badge>;
}
