import { PassChoice } from "@/components/booking/pass-choice";
import type { PassOption } from "@/types";

type StepPassProps = {
  passes: readonly PassOption[];
  value: string | null;
  onChange: (passId: string) => void;
  error?: string;
  disabled?: boolean;
};

/** Step 2 — pick the pass category. Prices and limits come from the database. */
export function StepPass({ passes, value, onChange, error, disabled }: StepPassProps) {
  const onSale = passes.filter((pass) => pass.availability.enabled);
  const selected = passes.find((pass) => pass.id === value) ?? null;

  if (passes.length === 0) {
    return (
      <p className="text-muted text-sm">
        This event has no pass categories yet. Message the organiser on WhatsApp for help.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted text-sm/6">
        {onSale.length === passes.length
          ? "Every pass type is on sale."
          : `${onSale.length} of ${passes.length} pass types are on sale — the rest are shown for reference only.`}{" "}
        A pass admits a fixed group, and the price shown is per pass, not per person.
      </p>

      <fieldset disabled={disabled}>
        <legend className="sr-only">Choose a pass type</legend>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {passes.map((pass) => (
            <li key={pass.id} className="h-full">
              <PassChoice
                pass={pass}
                name="pass-category"
                selected={pass.id === value}
                onSelect={() => onChange(pass.id)}
              />
            </li>
          ))}
        </ul>
      </fieldset>

      <p aria-live="polite" className="text-muted text-sm">
        {selected
          ? `${selected.name} selected — admits ${selected.numberOfPeople} ${selected.numberOfPeople === 1 ? "person" : "people"} per pass, up to ${selected.maxPerBooking} per booking.`
          : "Choose a pass to continue."}
      </p>

      {error ? (
        <p role="alert" className="text-rani-soft text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
