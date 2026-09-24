"use client";

import type { ReactNode } from "react";

import { ChevronLeftIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

type BookingBottomBarProps = {
  /** Small label above the value, e.g. "Selected date & time" or "Total". */
  eyebrow: string;
  /** The context line — the chosen date/time, or the running total. */
  value: ReactNode;
  /** Shown from the tickets step onwards, in place of the footer's Back button. */
  onBack?: () => void;
  onProceed: () => void;
  proceedLabel?: string;
  proceedDisabled?: boolean;
};

/**
 * The pinned checkout bar from the booking-flow references: what has been
 * chosen on the left, "Proceed" on the right. It renders on small screens only
 * — from `lg` up the wizard card keeps its own Back/Continue footer — and the
 * wizard mounts a matching spacer so the bar never covers step content.
 */
export function BookingBottomBar({
  eyebrow,
  value,
  onBack,
  onProceed,
  proceedLabel = "Proceed",
  proceedDisabled = false,
}: BookingBottomBarProps) {
  return (
    <div className="border-border/60 bg-background/92 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <Container className="flex items-center gap-3 py-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to the previous step"
            className="border-border bg-surface-raised/70 text-muted hover:text-foreground flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-muted/80 text-[0.625rem] font-semibold tracking-widest uppercase">
            {eyebrow}
          </span>
          <span className="truncate text-sm font-bold tracking-tight">{value}</span>
        </div>

        <Button onClick={onProceed} disabled={proceedDisabled} size="lg" className="shrink-0 px-6">
          {proceedLabel}
        </Button>
      </Container>
    </div>
  );
}

/**
 * Height-matched spacer rendered in the wizard's layout flow wherever the
 * fixed bar is mounted, so the last rows of the step can scroll into view.
 */
export function BookingBottomBarSpacer() {
  return <div aria-hidden="true" className="h-20 lg:hidden" />;
}
