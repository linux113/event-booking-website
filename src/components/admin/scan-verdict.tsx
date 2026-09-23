"use client";

import { ButtonElement } from "@/components/ui/button";
import { presentVerdict } from "@/lib/admin/verdict";
import { formatEventDate, formatTimeRange, formatTimestamp } from "@/lib/format";
import type { PassScanResult } from "@/types/admin";

/**
 * The verdict for one scanned pass.
 *
 * The layout is driven by the queue at the door, not by symmetry: the answer is the
 * largest thing on the screen, the guest's name and the night come next (those are
 * the two things a staff member reads out loud), and the action is a single obvious
 * button. Everything the scanner knows is shown — but it only ever knows what the
 * database was willing to say, which is why there is no mobile number or email
 * address here to begin with.
 */

const TONE_STYLES = {
  go: {
    panel: "border-peacock/50 bg-peacock/10",
    mark: "bg-peacock/15 text-peacock",
    text: "text-peacock-soft",
  },
  warn: {
    panel: "border-marigold/50 bg-marigold/10",
    mark: "bg-marigold/15 text-marigold",
    text: "text-marigold-soft",
  },
  stop: {
    panel: "border-rani/50 bg-rani/10",
    mark: "bg-rani/15 text-rani-soft",
    text: "text-rani-soft",
  },
  info: {
    panel: "border-border bg-surface/60",
    mark: "bg-surface-raised text-muted",
    text: "text-foreground",
  },
} as const;

type ScanVerdictProps = {
  result: PassScanResult;
  /** True while a check-in request is in flight. */
  busy: boolean;
  onCheckIn: () => void;
  onNext: () => void;
};

export function ScanVerdict({ result, busy, onCheckIn, onNext }: ScanVerdictProps) {
  const verdict = presentVerdict(result);
  const tone = TONE_STYLES[verdict.tone];
  const timeRange = formatTimeRange(result.startTime, result.endTime);

  const facts: Array<{ label: string; value: string }> = [
    { label: "Customer", value: result.customerName },
    { label: "Pass", value: [result.passName, result.passComposition].filter(Boolean).join(" · ") },
    {
      label: "Date",
      value: result.eventDate ? [formatEventDate(result.eventDate), timeRange].filter(Boolean).join(" · ") : null,
    },
    { label: "Pass ID", value: result.passId },
    {
      label: "Booking",
      value:
        result.bookingReference && result.passNumber && result.passTotal
          ? `${result.bookingReference} · pass ${result.passNumber} of ${result.passTotal}`
          : result.bookingReference,
    },
    { label: "Venue", value: result.venueName ? [result.venueName, result.city].filter(Boolean).join(", ") : null },
    { label: "Payment", value: result.paymentStatus ? result.paymentStatus.toUpperCase() : null },
    { label: "Checked in", value: result.checkedInAt ? formatTimestamp(result.checkedInAt) : null },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col gap-5 rounded-2xl border p-5 sm:p-6 ${tone.panel}`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl font-bold ${tone.mark}`}
        >
          {verdict.symbol}
        </span>
        <p className={`text-2xl leading-tight font-bold tracking-tight sm:text-3xl ${tone.text}`}>
          {verdict.headline}
        </p>
      </div>

      {verdict.detail ? <p className="text-foreground text-sm/6 font-medium">{verdict.detail}</p> : null}

      {facts.length > 0 ? (
        <dl className="border-border/70 grid gap-x-6 gap-y-3 border-t pt-5 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-0.5">
              <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{fact.label}</dt>
              <dd className="text-sm font-semibold break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="text-muted text-xs/5">{verdict.instruction}</p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {verdict.canCheckIn ? (
          <ButtonElement
            size="lg"
            onClick={onCheckIn}
            disabled={busy}
            className="w-full text-base sm:w-auto sm:min-w-52"
          >
            {busy ? "Checking in…" : "CHECK IN"}
          </ButtonElement>
        ) : null}

        <ButtonElement
          variant={verdict.canCheckIn ? "secondary" : "primary"}
          size="lg"
          onClick={onNext}
          disabled={busy}
          className="w-full sm:w-auto"
        >
          Scan next pass
        </ButtonElement>
      </div>
    </div>
  );
}
