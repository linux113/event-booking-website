/**
 * Raw row values → the string shapes the rest of the app is typed against.
 *
 * Every row interface (`src/types/database.ts`, the service layer's row shapes)
 * and every mapper declares date-like columns as plain `string`, because the
 * Supabase/PostgREST client this code replaced returned plain strings:
 * `2026-10-11`, `19:00:00`, ISO timestamps. Prisma 7 does not: its client
 * turns `date`, `time` and `timestamptz` columns into JS `Date` objects
 * (`date` at UTC midnight, `time` anchored at the 1970-01-01 UTC epoch day,
 * timestamps as the instant). Left alone, those objects reach `.slice()`,
 * `.localeCompare()`, `<input type="date" value>` and React children — which
 * is what crashed the Vercel build on `/about` (`a.value.localeCompare is not
 * a function` in `src/lib/format.ts`).
 *
 * This module restores the documented string contract at the single exit point
 * every query goes through (`sql()` in `src/lib/db/client.ts`), so callers keep
 * receiving exactly what their types already promise:
 *
 *   `date`       → `2026-10-11`                 (UTC-midnight instant → calendar date)
 *   `time`       → `19:00:00` or `19:00:00.500` (epoch-day instant → time of day)
 *   `timestamp*` → `2026-10-11T18:04:00.000Z`   (instant preserved, UTC-labelled)
 *   `null`       → `null`
 *
 * Everything else — text, numbers, booleans, jsonb, arrays of non-dates,
 * bytea buffers — passes through untouched. Pure and dependency-free so the
 * rules are directly unit-testable (`scripts/test/db-normalise.test.mjs`).
 */

/** One day in milliseconds — the span a Postgres `time` can occupy. */
const MS_PER_DAY = 86_400_000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * A `Date` from Prisma back to its string shape.
 *
 * An unparseable (Invalid) Date becomes `null` rather than throwing —
 * `toISOString()` would raise, and a corrupt value must not take a page down.
 */
export function normaliseTemporal(value: Date): string | null {
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const epochMs = value.getTime();

  // `time` columns: Prisma anchors them inside the Unix epoch day
  // (1970-01-01T00:00:00Z … 1970-01-01T23:59:59.999Z). Checked *before* the
  // calendar-date rule so a time of `00:00:00` does not read as the date
  // 1970-01-01. No event night or booking timestamp in this app is a real
  // moment inside 1970-01-01, so the window is unambiguous here.
  if (epochMs >= 0 && epochMs < MS_PER_DAY) {
    const base = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(
      value.getUTCSeconds(),
    )}`;
    const millis = value.getUTCMilliseconds();

    return millis > 0 ? `${base}.${pad(millis, 3)}` : base;
  }

  // `date` columns parse as UTC midnight (date-only ISO strings are UTC per
  // spec), so a midnight instant is a calendar date — rendered from the UTC
  // getters, the same anchor `src/lib/format.ts` uses. A *timestamp* that
  // happens to land exactly on UTC midnight collapses to the same shape: the
  // calendar day is still right and `formatTimestamp` still shows midnight.
  if (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return value.toISOString().slice(0, 10);
  }

  // Anything else is a moment: keep the instant, label it UTC.
  return value.toISOString();
}

function normaliseValue(value: unknown): unknown {
  if (value instanceof Date) {
    return normaliseTemporal(value);
  }

  if (Array.isArray(value)) {
    return value.map(normaliseValue);
  }

  // Recurse through plain objects (jsonb results, nested rows). Typed objects
  // such as Buffers/Uint8Arrays (bytea) and class instances are left alone.
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);

    if (prototype === Object.prototype || prototype === null) {
      const result: Record<string, unknown> = {};

      for (const [key, entry] of Object.entries(value)) {
        result[key] = normaliseValue(entry);
      }

      return result;
    }
  }

  return value;
}

/**
 * Normalise one `$queryRaw` / `$queryRawUnsafe` result set: an array of row
 * objects (or, for `select fn() as value`-style scalar reads, an array of
 * single-field rows). Non-array results pass through unchanged.
 */
export function normaliseRows<T>(rows: T): T {
  if (!Array.isArray(rows)) {
    return rows;
  }

  return (rows as unknown[]).map((row) => normaliseValue(row)) as unknown as T;
}
