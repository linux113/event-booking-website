import { cn } from "@/lib/utils";

export type StatTone = "default" | "positive" | "attention" | "quiet";

const toneStyles: Record<StatTone, string> = {
  default: "border-border bg-surface/50",
  positive: "border-peacock/40 bg-peacock/10",
  attention: "border-marigold/35 bg-marigold/[0.07]",
  quiet: "border-border/70 bg-surface/30",
};

type StatCardProps = {
  label: string;
  /** Already formatted: a number, a currency amount, or null when it is withheld. */
  value: string | null;
  hint?: string;
  tone?: StatTone;
  /** Shown in place of the value when the figure exists but this role may not see it. */
  withheldNote?: string;
  className?: string;
};

/**
 * One statistic.
 *
 * Three states, and they are deliberately different from one another:
 *
 *   * a **value**, for a figure this role may see;
 *   * **withheld** (`value === null` with a note) — the database returned no figure
 *     because the role may not have it. It is never rendered as `0`, because "no
 *     revenue" and "not your business" are different sentences;
 *   * an em dash for a figure nobody has yet, such as tonight's door count on a
 *     night with no bookings.
 *
 * The label is a `dt` and the number a `dd`, so the whole grid is a description list
 * to a screen reader and the pairs are read together rather than as a wall of text.
 */
export function StatCard({ label, value, hint, tone = "default", withheldNote, className }: StatCardProps) {
  const withheld = value === null && Boolean(withheldNote);

  return (
    <div className={cn("flex flex-col gap-1.5 rounded-2xl border p-4", toneStyles[tone], className)}>
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="flex flex-col gap-1">
        {withheld ? (
          <span className="text-muted text-sm/6 font-medium">{withheldNote}</span>
        ) : (
          <span
            className={cn(
              "text-2xl font-bold tracking-tight tabular-nums",
              value === null && "text-muted/60",
              tone === "positive" && "text-peacock-soft",
            )}
          >
            {value ?? "—"}
          </span>
        )}
        {/* The hint describes the figure. When the figure is withheld there is nothing
            for it to describe, so it is not rendered at all. */}
        {hint && !withheld ? <span className="text-muted text-xs/5">{hint}</span> : null}
      </dd>
    </div>
  );
}

/** The grid every group of statistics sits in. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {children}
    </dl>
  );
}
