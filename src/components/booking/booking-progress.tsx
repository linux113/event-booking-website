import { cn } from "@/lib/utils";
import type { BookingStep } from "@/types/booking";

export type BookingStepDefinition = {
  id: BookingStep;
  /** Short name for the stepper. */
  label: string;
  /** Heading shown above the step body. */
  title: string;
  /** One line of guidance under the heading. */
  description: string;
};

type BookingProgressProps = {
  steps: readonly BookingStepDefinition[];
  current: BookingStep;
};

/**
 * Checkout stepper.
 *
 * The current step is marked with `aria-current="step"` and the list is a
 * description of where the visitor is, not a control — changing steps happens
 * with the Back/Continue buttons, so the flow cannot skip validation.
 */
export function BookingProgress({ steps, current }: BookingProgressProps) {
  const currentIndex = steps.findIndex((step) => step.id === current);

  return (
    <nav aria-label="Checkout progress" className="flex flex-col gap-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((step, index) => {
          const isCurrent = step.id === current;
          const isDone = index < currentIndex;

          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "border-border flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide",
                  isCurrent
                    ? "border-marigold/50 bg-marigold/10 text-marigold-soft"
                    : isDone
                      ? "text-peacock border-peacock/40 bg-peacock/10"
                      : "text-muted bg-surface/50",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[0.6875rem]",
                    isCurrent ? "bg-marigold text-marigold-foreground" : "bg-surface-raised/70",
                  )}
                >
                  {isDone ? "✓" : index + 1}
                </span>
                {step.label}
                {isDone ? <span className="sr-only"> (completed)</span> : null}
              </span>

              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="bg-border hidden h-px w-4 sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-muted/80 text-xs">
        Step {currentIndex + 1} of {steps.length}
      </p>
    </nav>
  );
}
