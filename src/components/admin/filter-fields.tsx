import Link from "next/link";
import type { Route } from "next";

import type { FilterOption } from "@/lib/admin/bookings";

/**
 * The form controls every operations filter bar is built from.
 *
 * Extracted so the three admin lists share one definition of a filter field: the same
 * label treatment, the same height, the same focus ring, and the same rule that a select
 * always offers an explicit "any" option — a list that opens narrowed hides rows from
 * whoever did not notice a select was set.
 *
 * These are plain `GET`-form controls with no state: the filter bars submit, the page
 * re-renders from the query string, and every filtered view is a URL that can be
 * bookmarked, shared and reloaded.
 */

export const FILTER_FIELD_CLASS =
  "border-border bg-background/60 placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 h-10 w-full rounded-xl border px-3 text-sm transition-colors focus:ring-2 focus:outline-none";

export const FILTER_LABEL_CLASS = "text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase";

/** A free-text filter: one line, no autocomplete, no surprises. */
export function TextField({
  id,
  name,
  label,
  value,
  placeholder,
  hint,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={FILTER_LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="search"
        defaultValue={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        enterKeyHint="search"
        className={FILTER_FIELD_CLASS}
      />
      {hint ? <p className="text-muted text-xs/5">{hint}</p> : null}
    </div>
  );
}

/** One end of a date range. */
export function DateField({ id, name, label, value }: { id: string; name: string; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={FILTER_LABEL_CLASS}>
        {label}
      </label>
      <input id={id} name={name} type="date" defaultValue={value} className={FILTER_FIELD_CLASS} />
    </div>
  );
}

/** A filter with a fixed set of values, including "any". */
export function SelectField({
  id,
  name,
  label,
  value,
  options,
  anyLabel,
  customLabel,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: readonly FilterOption[];
  anyLabel: string;
  /**
   * Optional free-text alternative shown under the select — for a filter whose values
   * come from the gateway rather than from the schema (event types, which Razorpay may
   * extend at any time, so the list here is a shortcut and not a closed set).
   */
  customLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={FILTER_LABEL_CLASS}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} className={`${FILTER_FIELD_CLASS} appearance-none`}>
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {customLabel && !options.some((option) => option.value === value) && value ? (
        <p className="text-muted text-xs/5">
          {customLabel}: <span className="font-mono">{value}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The actions row every filter bar ends with: clear the filters, or take them away as a
 * file.
 *
 * The export is a link rather than a button, carrying the *applied* filters: a second
 * submit inside the form would export whatever was typed but not yet submitted, which is
 * exactly the "which filters did this file use?" question an export must not raise.
 * "Clear" is an ordinary link back to the unfiltered screen, so the URL after clearing
 * is the same URL everybody else sees.
 */
export function FilterActions({
  clearHref,
  cleared,
  exportHref,
  exportLabel = "Download CSV",
  exportNote,
}: {
  /** Where "clear filters" goes — the same screen, unfiltered. */
  clearHref: string;
  /** True when something is set, so clearing is worth offering. */
  cleared: boolean;
  exportHref?: string;
  exportLabel?: string;
  /** Spoken and hovered, so a download's scope is never a guess. */
  exportNote?: string;
}) {
  const base = "inline-flex h-10 items-center justify-center rounded-full border px-5 text-sm font-semibold tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {cleared ? (
        <Link href={clearHref as Route} className={`${base} border-border text-muted hover:text-foreground hover:border-marigold/50 focus-visible:ring-marigold/40`}>
          Clear filters
        </Link>
      ) : null}

      {exportHref ? (
        <a
          href={exportHref}
          title={exportNote}
          className={`${base} border-border text-muted hover:text-foreground hover:border-marigold/50 focus-visible:ring-marigold/40 ml-auto`}
        >
          {exportLabel}
          {exportNote ? <span className="sr-only"> — {exportNote}</span> : null}
        </a>
      ) : null}
    </div>
  );
}
