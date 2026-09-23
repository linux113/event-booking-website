export type StatusTone = "go" | "warn" | "stop";

const TONES: Record<StatusTone, string> = {
  go: "border-peacock/40 bg-peacock/10 text-peacock-soft",
  warn: "border-marigold/40 bg-marigold/10 text-marigold-soft",
  stop: "border-rani/40 bg-rani/10 text-rani-soft",
};

/**
 * A booking or payment status, in the one colour language the whole admin area uses:
 * green for done, gold for waiting on something, pink for stopped.
 *
 * Colour is never the only signal — the pill always carries the status word itself,
 * spelled out, so the meaning survives being read without colour.
 */
export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-widest uppercase ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}

/**
 * Which tone a status word deserves.
 *
 * An unknown status is treated as stopped rather than as fine: if the database ever
 * holds a value this function has not been taught, the safe reading of it is "look at
 * this", not "all good".
 */
export function statusTone(status: string): StatusTone {
  if (["confirmed", "paid", "active", "used"].includes(status)) {
    return "go";
  }

  if (["pending", "unpaid", "created"].includes(status)) {
    return "warn";
  }

  return "stop";
}
