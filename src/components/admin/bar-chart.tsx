import { axisLabelIndices, axisMax, barPercent } from "@/lib/admin/dashboard";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChartPoint = {
  /** `YYYY-MM-DD` in the venue's timezone. */
  day: string;
  value: number;
  /** A second, usually smaller count drawn inside the same bar. */
  secondary?: number;
};

type DailyBarChartProps = {
  id: string;
  title: string;
  description: string;
  points: readonly ChartPoint[];
  /** Formats the value for the tooltip, the caption and the axis top. */
  formatValue: (value: number) => string;
  /** Legend entries: what the full bar and the inner bar mean. */
  primaryLabel: string;
  secondaryLabel?: string;
  /** Tone of the bars: money is gold, volume is pink. */
  tone?: "marigold" | "rani";
  /** Replaces the chart when the role may not see the figures behind it. */
  withheldNote?: string;
  /** Caption under the chart, e.g. what the window covers. */
  footer?: string;
};

const toneStyles = {
  marigold: {
    bar: "bg-marigold/25",
    inner: "bg-marigold",
    peak: "text-marigold-soft",
  },
  rani: {
    bar: "bg-rani/25",
    inner: "bg-rani",
    peak: "text-rani-soft",
  },
} as const;

/**
 * A day-by-day bar chart, drawn with divs.
 *
 * No charting dependency: a dashboard that adds 40kB of JavaScript to draw fourteen
 * bars is a worse dashboard. The bars are ordinary elements sized by percentage, so
 * they scale with the container at any width, print, and cannot be the thing that
 * breaks the page if a script fails to load.
 *
 * It is a *picture of a table*, so it is labelled like one: the drawing carries an
 * `aria-label` naming the total and the busiest day, and the same series is rendered
 * beside it as a visually hidden table for a screen reader. (`role="img"` sits on the
 * drawing alone — put it around the table as well and the table would be, correctly
 * and uselessly, ignored.) Colour is never the only signal: the bar heights, the axis
 * labels and the hidden table all say the same thing.
 *
 * Days with nothing are drawn as a flat stub on the baseline rather than a gap, so
 * "we took no money that Tuesday" is visible instead of merely absent.
 */
export function DailyBarChart({
  id,
  title,
  description,
  points,
  formatValue,
  primaryLabel,
  secondaryLabel,
  tone = "rani",
  withheldNote,
  footer,
}: DailyBarChartProps) {
  if (withheldNote) {
    return (
      <figure className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-4 sm:p-5">
        <figcaption className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-muted text-xs/5">{description}</p>
        </figcaption>
        <p className="text-muted border-border/70 bg-background/40 rounded-xl border px-4 py-6 text-center text-sm/6">
          {withheldNote}
        </p>
      </figure>
    );
  }

  const max = axisMax(points.map((point) => point.value));
  const labels = axisLabelIndices(points.length - 1, 4);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const peak = points.reduce<ChartPoint | null>(
    (best, point) => (point.value > (best?.value ?? 0) ? point : best),
    null,
  );
  const styles = toneStyles[tone];

  return (
    <figure id={id} className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-muted text-xs/5">{description}</p>
        </div>
        <div className="text-muted flex flex-wrap items-center gap-3 text-[0.6875rem] font-semibold tracking-wider uppercase">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-2.5 rounded-sm", styles.bar)} />
            {primaryLabel}
          </span>
          {secondaryLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-2.5 rounded-sm", styles.inner)} />
              {secondaryLabel}
            </span>
          ) : null}
        </div>
      </figcaption>

      <div
        role="img"
        aria-label={`${title}: ${formatValue(total)} in total over ${points.length} days${
          peak && peak.value > 0 ? `, busiest on ${formatShortDate(peak.day)} with ${formatValue(peak.value)}` : ""
        }.`}
        className="flex flex-col gap-2"
      >
        <div className="text-muted flex justify-between text-[0.6875rem] tabular-nums">
          <span>{formatValue(max)}</span>
          <span aria-hidden="true">{formatValue(Math.round(max / 2))}</span>
          <span aria-hidden="true">0</span>
        </div>

        <div className="border-border/60 flex h-36 items-end gap-[2px] border-b sm:gap-1">
          {points.map((point, index) => {
            const height = barPercent(point.value, max);
            const innerHeight =
              point.secondary !== undefined && point.value > 0
                ? Math.min(100, (point.secondary / point.value) * 100)
                : 0;

            return (
              <div key={point.day} title={`${formatShortDate(point.day)} · ${formatValue(point.value)}`} className="group relative flex h-full flex-1 items-end">
                <span
                  aria-hidden="true"
                  style={{ height: `${height}%` }}
                  className={cn(
                    "w-full rounded-t-[3px] transition-[filter] group-hover:brightness-125",
                    point.value > 0 ? styles.bar : "bg-surface-raised",
                  )}
                >
                  {innerHeight > 0 ? (
                    <span
                      style={{ height: `${innerHeight}%` }}
                      className={cn("block w-full rounded-t-[3px]", styles.inner)}
                    />
                  ) : null}
                </span>
                {labels.has(index) ? (
                  <span className="text-muted/70 absolute -bottom-6 left-1/2 -translate-x-1/2 text-[0.625rem] whitespace-nowrap tabular-nums">
                    {formatShortDate(point.day)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold tracking-tight tabular-nums">
            {formatValue(total)}
            <span className="text-muted ml-2 text-xs font-medium">
              {points.length} {points.length === 1 ? "day" : "days"}
            </span>
          </p>
          {peak && peak.value > 0 ? (
            <p className="text-muted text-xs tabular-nums">
              Busiest {formatShortDate(peak.day)} · <span className={styles.peak}>{formatValue(peak.value)}</span>
            </p>
          ) : (
            <p className="text-muted text-xs">Nothing recorded in this window yet</p>
          )}
        </div>
      </div>

      {/* Outside the drawing, so a screen reader gets the numbers rather than an image. */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">{primaryLabel}</th>
            {secondaryLabel ? <th scope="col">{secondaryLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">{formatShortDate(point.day)}</th>
              <td>{formatValue(point.value)}</td>
              {secondaryLabel ? <td>{formatValue(point.secondary ?? 0)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      {footer ? <p className="text-muted/80 text-xs/5">{footer}</p> : null}
    </figure>
  );
}
