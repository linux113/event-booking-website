import { UsersIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PassOption } from "@/types";

type PassChoiceProps = {
  pass: PassOption;
  /** Radio group name, so one grid is one single-choice group. */
  name: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
};

/**
 * One selectable pass category inside the checkout wizard.
 *
 * Mirrors the pass card visually but is an actual form control: a radio input the
 * visitor can reach with the keyboard, with the whole card as its label. A pass
 * the organiser has taken off sale stays visible as "Not on sale" and its input
 * is disabled — and the server refuses it anyway.
 */
export function PassChoice({ pass, name, selected, onSelect, disabled }: PassChoiceProps) {
  const isAvailable = pass.availability.enabled;
  const inputId = `pass-choice-${pass.id}`;
  const isDisabled = disabled || !isAvailable;

  return (
    <div
      className={cn(
        "border-border bg-surface/60 relative flex h-full flex-col gap-3 rounded-2xl border p-5 transition-colors",
        selected ? "border-marigold/60 bg-marigold/5" : null,
        !isAvailable ? "opacity-60 saturate-50" : null,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <label
            htmlFor={inputId}
            className={cn(
              "text-sm font-semibold tracking-tight",
              isDisabled ? "cursor-not-allowed" : "cursor-pointer",
            )}
          >
            {pass.name}
          </label>
          <p className="text-marigold-soft text-xs font-semibold">{pass.composition}</p>
        </div>

        {isAvailable ? null : <Badge variant="neutral">Not on sale</Badge>}
      </div>

      <p className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tracking-tight">{formatInr(pass.priceInr)}</span>
        <span className="text-muted text-xs">/ pass</span>
      </p>

      <p className="text-muted flex items-center gap-1.5 text-xs">
        <UsersIcon className="size-3.5" />
        Admits {pass.numberOfPeople} {pass.numberOfPeople === 1 ? "person" : "people"} · up to{" "}
        {pass.maxPerBooking} per booking
      </p>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <input
          id={inputId}
          type="radio"
          name={name}
          value={pass.id}
          checked={selected}
          disabled={isDisabled}
          onChange={onSelect}
          className="accent-marigold size-4 disabled:cursor-not-allowed"
        />
        <label
          htmlFor={inputId}
          className={cn(
            "text-xs font-medium",
            isDisabled ? "text-muted cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {isAvailable ? (selected ? "Selected" : "Select this pass") : pass.availability.reason}
        </label>
      </div>
    </div>
  );
}
