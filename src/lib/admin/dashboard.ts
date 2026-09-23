/**
 * The arithmetic behind the dashboard's charts.
 *
 * Kept out of the components and out of the database for two different reasons:
 *
 *   * the database counts the *data* (how many bookings, how much money), while
 *     this file only decides how to *draw* it — how tall a bar is, how far apart the
 *     gridlines are, what share of the total a category holds;
 *   * none of it is sensitive. A bar height is a ratio of two numbers that were
 *     already counted on the server and already checked for the caller, so
 *     there is nothing here that could reveal a figure withheld from the payload.
 *
 * Everything is pure: numbers in, numbers out, no dates read from the clock and no
 * formatting decisions that differ between the server and the browser.
 */

/**
 * The top of the value axis: the next "nice" number at or above the largest value.
 *
 * A chart that scales to exactly its biggest value makes that value's bar reach the
 * ceiling, which reads as "full" rather than "the largest so far". Rounding up to a
 * step of 1, 2, 5 or 10 × a power of ten gives a scale a reader recognises, and
 * leaves the tallest bar visibly short of the top. Zero data still gets an axis of 1,
 * so a quiet fortnight is an honest flat chart rather than a division by zero.
 */
export function axisMax(values: readonly number[]): number {
  const largest = values.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0);

  if (largest <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(largest));
  const normalised = largest / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

  return step * magnitude;
}

/** Where a value sits on the axis, as a percentage of its height. Never below 2%. */
export function barPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) {
    return 0;
  }

  return Math.max(2, Math.min(100, (value / max) * 100));
}

/** A share of a total, rounded to whole percents, for the distribution bars. */
export function sharePercent(value: number, total: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

/** The largest day in a series, or null when every day is zero. */
export function peakDay<T extends { bookings: number }>(series: readonly T[]): T | null {
  return series.reduce<T | null>((peak, point) => (point.bookings > (peak?.bookings ?? 0) ? point : peak), null);
}

/**
 * A short axis label every `step` days, plus the first and last day, so a 14-day
 * chart shows a handful of readable dates instead of fourteen cramped ones.
 *
 * Returned as a set of indices the caller can test against, which keeps the labels
 * and the bars in the same render pass — and keeps this file free of any opinion
 * about markup.
 */
export function axisLabelIndices(length: number, step = 4): Set<number> {
  const indices = new Set<number>();

  if (length <= 0) {
    return indices;
  }

  indices.add(0);
  indices.add(length - 1);

  for (let index = 0; index < length; index += step) {
    indices.add(index);
  }

  return indices;
}
